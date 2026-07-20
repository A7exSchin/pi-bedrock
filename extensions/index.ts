/**
 * pi-bedrock — Compaction-proof context injection for pi coding-agent.
 *
 * Reads vault core files and injects them into the system prompt on every turn
 * via `before_agent_start`. The system prompt is never compacted, so these
 * rules survive indefinitely.
 *
 * Features:
 *   - Core files (always): injected every session regardless of cwd.
 *   - Projects: path-scoped file injection when cwd is inside a project dir.
 *     Each project can optionally have a memory directory (all .md files scanned).
 *   - Ephemeral context: session-scoped strings added via /bedrock add.
 *   - Re-reads files from disk on every turn (always fresh, no stale rules).
 *   - Warns on startup if context files overlap with already-loaded AGENTS.md.
 *
 * Config: ~/.pi/agent/pi-bedrock.json (override via PI_BEDROCK_CONFIG env).
 * Commands: /bedrock [status|list|add <text>|clear|reload]
 */

import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	BeforeAgentStartEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ProjectConfig } from "./types.js";
import { loadConfig, CONFIG_PATH, RESERVED_SUBCOMMANDS } from "./config.js";
import { isInsidePath, shortenHome } from "./paths.js";
import { readFile, readFiles, readMemoryDir, findMissingFiles } from "./files.js";
import { formatSection } from "./format.js";
import { estimateTokens, formatTokens } from "./tokens.js";

/** Custom session-entry type used to persist the bound mode across reload/resume. */
const MODE_ENTRY_TYPE = "bedrock-mode";

export default function piBedrock(pi: ExtensionAPI) {
	let { config, warn, notes } = loadConfig();
	const ephemeralContext: string[] = [];
	let duplicationWarnings: string[] = [];
	let lastInjectionTokens: number | null = null;
	/** Mode bound to this session (immutable once the first turn happens). */
	let activeMode: string | null = null;

	function reload(): void {
		({ config, warn, notes } = loadConfig());
		duplicationWarnings = [];
		// activeMode is session state, not config — preserved across reload.
	}

	function getActiveProjects(cwd: string): ProjectConfig[] {
		if (!config) return [];
		return config.projects.filter((p) => isInsidePath(cwd, p.path));
	}

	/** True when the session already contains a real user/assistant turn. */
	function hasConversation(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		return entries.some(
			(e: any) =>
				e?.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"),
		);
	}

	/** Restore the bound mode from the session's last mode marker entry. */
	function restoreActiveMode(ctx: ExtensionContext): void {
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		let found: string | null = null;
		for (const e of entries as any[]) {
			if (e?.type === "custom" && e.customType === MODE_ENTRY_TYPE && typeof e.data?.mode === "string") {
				found = e.data.mode;
			}
		}
		activeMode = found;
	}

	function showStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const cwd = ctx.cwd ?? process.cwd();
		const activeProjects = getActiveProjects(cwd);
		const tokenInfo = lastInjectionTokens !== null ? ` (${formatTokens(lastInjectionTokens)})` : "";
		const modeInfo = activeMode ? ` · mode: ${activeMode}` : "";
		const label = warn
			? ctx.ui.theme.fg("dim", "pi-bedrock: inactive (config missing/invalid)")
			: ctx.ui.theme.fg(
					"dim",
					`pi-bedrock: ${config!.core.length} core` +
						`${config!.projects.length ? ` / ${activeProjects.length} of ${config!.projects.length} project(s) active` : ""}` +
						`${ephemeralContext.length ? ` + ${ephemeralContext.length} ephemeral` : ""}` +
						modeInfo +
						tokenInfo,
				);
		ctx.ui.setStatus("pi-bedrock", label + ctx.ui.theme.fg("dim", "  │"));
	}

	function checkMissingFiles(ctx: ExtensionContext): void {
		if (!config || !ctx.hasUI) return;
		const missing: string[] = [];

		// Core files
		for (const rel of findMissingFiles(config.vault, config.core)) {
			missing.push(`core: ${rel}`);
		}

		// Active project files
		const cwd = ctx.cwd ?? process.cwd();
		for (const proj of config.projects) {
			if (!isInsidePath(cwd, proj.path)) continue;
			const root = proj.root ?? proj.path;
			const label = proj.name ?? path.basename(proj.path);
			for (const rel of findMissingFiles(root, proj.files)) {
				missing.push(`${label}: ${rel}`);
			}
		}

		// Active mode files
		if (activeMode && config.modes[activeMode]) {
			for (const rel of findMissingFiles(config.vault, config.modes[activeMode].files)) {
				missing.push(`mode ${activeMode}: ${rel}`);
			}
		}

		if (missing.length > 0) {
			ctx.ui.notify(
				`pi-bedrock: ${missing.length} configured file(s) not found (silent context loss!):\n` +
					missing.map((m) => `  • ${m}`).join("\n"),
				"warning",
			);
		}
	}

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		restoreActiveMode(ctx);
		showStatus(ctx);
		if (!config || !ctx.hasUI) return;

		// Surface non-fatal config notes (e.g. mode name collisions)
		for (const note of notes) {
			ctx.ui.notify(`pi-bedrock: ${note}`, "warning");
		}

		if (activeMode) {
			if (config.modes[activeMode]) {
				ctx.ui.notify(`pi-bedrock: session mode "${activeMode}" active (locked for this session).`, "info");
			} else {
				ctx.ui.notify(
					`pi-bedrock: session bound to mode "${activeMode}" but it is no longer in config — nothing injected.`,
					"warning",
				);
			}
		}

		// Check for duplication with already-loaded context files
		const options = ctx.getSystemPromptOptions?.();
		if (options?.contextFiles && Array.isArray(options.contextFiles)) {
			const loadedPaths = new Set<string>();
			for (const cf of options.contextFiles) {
				if (cf.path) loadedPaths.add(path.resolve(cf.path));
			}
			const overlaps: string[] = [];
			for (const rel of config.core) {
				const abs = path.resolve(config.vault, rel);
				if (loadedPaths.has(abs)) overlaps.push(rel);
			}
			for (const proj of config.projects) {
				const root = proj.root ?? proj.path;
				for (const rel of proj.files) {
					const abs = path.resolve(root, rel);
					if (loadedPaths.has(abs)) overlaps.push(`${proj.name ?? path.basename(proj.path)}/${rel}`);
				}
			}
			if (overlaps.length > 0) {
				duplicationWarnings = overlaps;
				ctx.ui.notify(
					`pi-bedrock: ${overlaps.length} file(s) already loaded via AGENTS.md/context files: ${overlaps.join(", ")}. ` +
						"This means double token usage for those files. Consider removing the read instructions from AGENTS.md " +
						"since pi-bedrock now handles injection.",
					"warning",
				);
			}
		}

		if (warn) ctx.ui.notify(`pi-bedrock: ${warn}`, "warning");
		checkMissingFiles(ctx);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		if (!config) return undefined;

		const cwd = ctx.cwd ?? process.cwd();

		// Read core files fresh from disk every turn
		const coreFiles = readFiles(config.vault, config.core);

		// Build injection block
		const sections: string[] = [];
		const c = formatSection("Core Rules (always active)", coreFiles);
		if (c) sections.push(c);

		// Session mode — behavioral contract bound to this session
		if (activeMode && config.modes[activeMode]) {
			const modeFiles = readFiles(config.vault, config.modes[activeMode].files);
			const ms = formatSection(`Session Mode: ${activeMode} (active for this session)`, modeFiles);
			if (ms) sections.push(ms);
		}

		// Project-scoped context
		for (const proj of config.projects) {
			if (!isInsidePath(cwd, proj.path)) continue;
			const root = proj.root ?? proj.path;
			const projFiles = readFiles(root, proj.files);
			const label = proj.name ?? path.basename(proj.path);
			const ps = formatSection(`Project: ${label}`, projFiles);
			if (ps) sections.push(ps);
			// Memory directory
			if (proj.memory) {
				const memFiles = readMemoryDir(root, proj.memory);
				const ms = formatSection(`Memory: ${label}`, memFiles);
				if (ms) sections.push(ms);
			}
		}

		if (ephemeralContext.length > 0) {
			sections.push(
				`\n# Session Context (ephemeral)\n\n${ephemeralContext.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
			);
		}

		if (sections.length === 0) {
			lastInjectionTokens = 0;
			return undefined;
		}

		const injection =
			"\n\n<!-- pi-bedrock: injected rules (compaction-proof) -->\n" +
			sections.join("\n") +
			"\n<!-- /pi-bedrock -->\n";

		lastInjectionTokens = estimateTokens(injection);

		return {
			systemPrompt: event.systemPrompt + injection,
		};
	});

	pi.registerCommand("bedrock", {
		description:
			"pi-bedrock: status, list, add/clear ephemeral context, or bind a session mode. Usage: /bedrock [status|list|add <text>|clear|reload|<mode>]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = RESERVED_SUBCOMMANDS.map((s) => ({ value: s, label: s }));
			if (config) {
				for (const name of Object.keys(config.modes)) {
					items.push({ value: name, label: name, description: "session mode" });
				}
			}
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			const toks = args.trim().split(/\s+/);
			const sub = (toks[0] ?? "").toLowerCase();

			if (sub === "add") {
				const text = args.trim().slice(3).trim();
				if (!text) {
					ctx.ui.notify("Usage: /bedrock add <text>", "warning");
					return;
				}
				ephemeralContext.push(text);
				showStatus(ctx);
				ctx.ui.notify(`pi-bedrock: added ephemeral context (${ephemeralContext.length} total).`, "info");
				return;
			}

			if (sub === "clear") {
				const count = ephemeralContext.length;
				ephemeralContext.length = 0;
				showStatus(ctx);
				ctx.ui.notify(`pi-bedrock: cleared ${count} ephemeral context item(s). Static files remain.`, "info");
				return;
			}

			if (sub === "reload") {
				reload();
				showStatus(ctx);
				ctx.ui.notify(warn ? `pi-bedrock: ${warn}` : "pi-bedrock: config reloaded.", warn ? "warning" : "info");
				checkMissingFiles(ctx);
				return;
			}

			if (sub === "list") {
				if (!config) {
					ctx.ui.notify(warn ? `pi-bedrock: ${warn}` : "pi-bedrock: no config loaded.", "warning");
					return;
				}
				const cwd = ctx.cwd ?? process.cwd();
				const lines: string[] = [];

				lines.push(`vault: ${shortenHome(config.vault)}`);
				if (lastInjectionTokens !== null) {
					lines.push(`total injection: ${formatTokens(lastInjectionTokens)}`);
				}
				lines.push("");
				let coreSectionTokens = 0;
				const coreTokenDetails: string[] = [];
				for (const rel of config.core) {
					const abs = path.join(config.vault, rel);
					const content = readFile(abs);
					const exists = content !== null;
					const indicator = exists ? "●" : "?";
					const dup = duplicationWarnings.includes(rel) ? " ⚠ also in AGENTS.md" : "";
					const tokens = exists ? estimateTokens(content) : 0;
					coreSectionTokens += tokens;
					const tokenLabel = exists ? ` (${formatTokens(tokens)})` : "";
					coreTokenDetails.push(`  ${indicator} ${rel}${tokenLabel}${dup}`);
				}
				lines.push(`── Core (always injected) ── ${formatTokens(coreSectionTokens)}`);
				lines.push(...coreTokenDetails);

				if (config.projects.length > 0) {
					lines.push("");
					lines.push(`── Projects (${config.projects.length} configured) ──`);
					for (const proj of config.projects) {
						const active = isInsidePath(cwd, proj.path);
						const root = proj.root ?? proj.path;
						const label = proj.name ?? path.basename(proj.path);
						let projTokens = 0;

						// Pre-calculate tokens for the header
						const fileTokens: { rel: string; exists: boolean; tokens: number }[] = [];
						for (const rel of proj.files) {
							const filePath = path.join(root, rel);
							const content = readFile(filePath);
							const exists = content !== null;
							const tokens = exists ? estimateTokens(content) : 0;
							projTokens += tokens;
							fileTokens.push({ rel, exists, tokens });
						}
						let memFiles: ReturnType<typeof readMemoryDir> = [];
						let memTokens = 0;
						if (proj.memory) {
							memFiles = readMemoryDir(root, proj.memory);
							memTokens = memFiles.reduce((sum, f) => sum + estimateTokens(f.content), 0);
							projTokens += memTokens;
						}

						// Project header
						lines.push(`  ${active ? "●" : "○"} ${label}${active ? " — ACTIVE" : ""}`);
						lines.push(`    trigger: ${shortenHome(proj.path)}`);
						if (proj.root && proj.root !== proj.path) {
							lines.push(`    source:  ${shortenHome(proj.root)}`);
						}
						lines.push(`    tokens:  ${formatTokens(projTokens)}`);

						// File list
						lines.push(`    files:`);
						for (const ft of fileTokens) {
							const indicator = !ft.exists ? "?" : active ? "●" : "○";
							const tokenLabel = ft.exists ? ` (${formatTokens(ft.tokens)})` : "";
							lines.push(`      ${indicator} ${ft.rel}${tokenLabel}`);
						}
						if (proj.memory) {
							lines.push(`      ↳ memory: ${proj.memory} (${memFiles.length} file(s), ${formatTokens(memTokens)})`);
						}
					}
				}

				lines.push("");
				const modeNames = Object.keys(config.modes);
				lines.push(`── Modes (${modeNames.length} configured) ──`);
				if (modeNames.length === 0) {
					lines.push("  (none)");
				} else {
					for (const name of modeNames) {
						const isActive = activeMode === name;
						const files = config.modes[name].files;
						let modeTokens = 0;
						const fileLines: string[] = [];
						for (const rel of files) {
							const content = readFile(path.join(config.vault, rel));
							const exists = content !== null;
							const tokens = exists ? estimateTokens(content) : 0;
							modeTokens += tokens;
							const indicator = !exists ? "?" : isActive ? "●" : "○";
							fileLines.push(`      ${indicator} ${rel}${exists ? ` (${formatTokens(tokens)})` : ""}`);
						}
						lines.push(
							`  ${isActive ? "●" : "○"} ${name}${isActive ? " — ACTIVE" : ""} (${files.length} file(s), ${formatTokens(modeTokens)})`,
						);
						lines.push(...fileLines);
					}
				}

				lines.push("");
				const ephTokens = ephemeralContext.length > 0
					? estimateTokens(ephemeralContext.join("\n"))
					: 0;
				lines.push(`── Ephemeral (session-scoped, ${ephemeralContext.length} item(s)) ──${ephTokens > 0 ? " " + formatTokens(ephTokens) : ""}`);
				if (ephemeralContext.length === 0) {
					lines.push("  (none)");
				} else {
					for (const [i, s] of ephemeralContext.entries()) {
						lines.push(`  ${i + 1}. ${s.length > 80 ? s.slice(0, 77) + "..." : s}`);
					}
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			// Default: status
			// Mode activation: /bedrock <modename>
			if (sub && config && config.modes[sub]) {
				if (activeMode === sub) {
					ctx.ui.notify(`pi-bedrock: mode "${sub}" already active for this session.`, "info");
					return;
				}
				if (hasConversation(ctx)) {
					ctx.ui.notify(
						`pi-bedrock: cannot set mode "${sub}" — this session already has history. ` +
							`Modes bind at session start. Run /new, then /bedrock ${sub}.`,
						"warning",
					);
					return;
				}
				// Empty session: bind (re-binding while still empty overwrites the choice)
				activeMode = sub;
				pi.appendEntry(MODE_ENTRY_TYPE, { mode: sub });
				showStatus(ctx);
				const fileCount = config.modes[sub].files.length;
				if (fileCount === 0) {
					ctx.ui.notify(
						`pi-bedrock: mode "${sub}" bound to this session, but it has no files — nothing will be injected.`,
						"warning",
					);
				} else {
					ctx.ui.notify(
						`pi-bedrock: mode "${sub}" bound to this session (${fileCount} file(s)). Locked after the first turn.`,
						"info",
					);
				}
				return;
			}

			// Unknown token: neither a subcommand nor a configured mode
			if (sub && sub !== "status") {
				const modeNames = config ? Object.keys(config.modes) : [];
				ctx.ui.notify(
					`pi-bedrock: unknown command "${sub}". Subcommands: ${RESERVED_SUBCOMMANDS.join(", ")}.` +
						(modeNames.length ? ` Modes: ${modeNames.join(", ")}.` : ""),
					"warning",
				);
				return;
			}

			// Default: status
			showStatus(ctx);
			if (!config) {
				ctx.ui.notify(warn ? `pi-bedrock: ${warn}` : "pi-bedrock: not configured.", "warning");
				return;
			}
			const cwd = ctx.cwd ?? process.cwd();
			const activeProjects = getActiveProjects(cwd);
			ctx.ui.notify(
				`pi-bedrock: ${config.core.length} core` +
					`${config.projects.length ? `, ${config.projects.length} project(s) (${activeProjects.length} active)` : ""}` +
					`${ephemeralContext.length ? `, ${ephemeralContext.length} ephemeral` : ""}` +
					`${activeMode ? `, mode: ${activeMode}` : ""}` +
					`. Vault: ${config.vault}. Source: ${CONFIG_PATH}.`,
				"info",
			);
		},
	});
}
