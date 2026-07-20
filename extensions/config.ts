import * as fs from "node:fs";
import * as path from "node:path";
import { HOME, expandHome } from "./paths.js";
import type { Config, LoadResult, ModeConfig, ProjectConfig } from "./types.js";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(HOME, ".pi", "agent");
export const CONFIG_PATH = process.env.PI_BEDROCK_CONFIG ?? path.join(AGENT_DIR, "pi-bedrock.json");

/** Subcommand names of /bedrock that a mode name must not shadow. */
export const RESERVED_SUBCOMMANDS = ["status", "list", "add", "clear", "reload"] as const;

export function loadConfig(configPath: string = CONFIG_PATH): LoadResult {
	const notes: string[] = [];
	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed.vault || !Array.isArray(parsed.core)) {
			return { config: null, warn: "Config missing required fields (vault, core).", notes };
		}
		const projects: ProjectConfig[] = [];
		if (Array.isArray(parsed.projects)) {
			for (const p of parsed.projects) {
				if (p && typeof p.path === "string" && Array.isArray(p.files)) {
					projects.push({
						path: expandHome(p.path),
						name: p.name,
						root: typeof p.root === "string" ? expandHome(p.root) : undefined,
						files: p.files,
						memory: typeof p.memory === "string" ? p.memory : undefined,
					});
				}
			}
		}
		const modes: Record<string, ModeConfig> = {};
		if (parsed.modes && typeof parsed.modes === "object" && !Array.isArray(parsed.modes)) {
			for (const [name, value] of Object.entries(parsed.modes)) {
				if ((RESERVED_SUBCOMMANDS as readonly string[]).includes(name)) {
					notes.push(`Mode "${name}" ignored: name collides with a reserved /bedrock subcommand.`);
					continue;
				}
				const files = Array.isArray((value as any)?.files)
					? (value as any).files.filter((f: unknown): f is string => typeof f === "string")
					: [];
				modes[name] = { files };
			}
		}
		const config: Config = {
			vault: expandHome(parsed.vault),
			core: parsed.core,
			projects,
			modes,
		};
		return { config, warn: null, notes };
	} catch (e: any) {
		if (e.code === "ENOENT") return { config: null, warn: `Config not found: ${configPath}`, notes };
		return { config: null, warn: `Config error: ${e.message}`, notes };
	}
}
