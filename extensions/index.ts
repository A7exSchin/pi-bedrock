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
import type { ProjectConfig } from "./types.js";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { isInsidePath } from "./paths.js";
import { readFile, readFiles, readMemoryDir, findMissingFiles } from "./files.js";
import { formatSection } from "./format.js";
import { estimateTokens, formatTokens } from "./tokens.js";

export default function piBedrock(pi: ExtensionAPI) {
	let { config, warn } = loadConfig();
	const ephemeralContext: string[] = [];
	let duplicationWarnings: string[] = [];
	let lastInjectionTokens: number | null = null;

	function reload(): void {
		({ config, warn } = loadConfig());
		duplicationWarnings = [];
	}

	function getActiveProjects(cwd: string): ProjectConfig[] {
		if (!config) return [];
		return config.projects.filter((p) => isInsidePath(cwd, p.path));
	}

	function showStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const cwd = ctx.cwd ?? process.cwd();
		const activeProjects = getActiveProjects(cwd);
		const tokenInfo = lastInjectionTokens !== null ? ` (${formatTokens(lastInjectionTokens)})` : "";
		const label = warn
			? ctx.ui.theme.fg("dim", "pi-bedrock: inactive (config missing/invalid)")
			: ctx.ui.theme.fg(
					"dim",
					`pi-bedrock: ${config!.core.length} core` +
						`${config!.projects.length ? ` / ${activeProjects.length} of ${config!.projects.length} project(s) active` : ""}` +
						`${ephemeralContext.length ? ` + ${ephemeralContext.length} ephemeral` : ""}` +
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

		if (missing.length > 0) {
			ctx.ui.notify(
				`pi-bedrock: ${missing.length} configured file(s) not found (silent context loss!):\n` +
					missing.map((m) => `  • ${m}`).join("\n"),
				"warning",
			);
		}
	}

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		showStatus(ctx);
		if (!config || !ctx.hasUI) return;

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
			"pi-bedrock: status, list loaded context, add/clear ephemeral context. Usage: /bedrock [status|list|add <text>|clear|reload]",
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

				lines.push(`vault: ${config.vault}`);
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
						lines.push(`  ${active ? "●" : "○"} ${label} (${proj.path})${active ? " — ACTIVE" : ""}`);
						if (proj.root) lines.push(`    root: ${proj.root}`);
						for (const rel of proj.files) {
							const filePath = path.join(root, rel);
							const content = readFile(filePath);
							const exists = content !== null;
							const indicator = !exists ? "?" : active ? "●" : "○";
							const tokens = exists ? estimateTokens(content) : 0;
							projTokens += tokens;
							const tokenLabel = exists ? ` (${formatTokens(tokens)})` : "";
							lines.push(`    ${indicator} ${rel}${tokenLabel}`);
						}
						if (proj.memory) {
							const memFiles = readMemoryDir(root, proj.memory);
							const memTokens = memFiles.reduce((sum, f) => sum + estimateTokens(f.content), 0);
							projTokens += memTokens;
							lines.push(`    ↳ memory: ${proj.memory} (${memFiles.length} file(s), ${formatTokens(memTokens)})`);
						}
						lines.push(`    subtotal: ${formatTokens(projTokens)}`);
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
					`. Vault: ${config.vault}. Source: ${CONFIG_PATH}.`,
				"info",
			);
		},
	});
}
