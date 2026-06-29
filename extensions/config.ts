import * as fs from "node:fs";
import * as path from "node:path";
import { HOME, expandHome } from "./paths.js";
import type { Config, LoadResult, ProjectConfig } from "./types.js";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(HOME, ".pi", "agent");
export const CONFIG_PATH = process.env.PI_BEDROCK_CONFIG ?? path.join(AGENT_DIR, "pi-bedrock.json");

export function loadConfig(configPath: string = CONFIG_PATH): LoadResult {
	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed.vault || !Array.isArray(parsed.core)) {
			return { config: null, warn: "Config missing required fields (vault, core)." };
		}
		const projects: ProjectConfig[] = [];
		if (Array.isArray(parsed.projects)) {
			for (const p of parsed.projects) {
				if (p && typeof p.path === "string" && Array.isArray(p.files)) {
					projects.push({
						path: expandHome(p.path),
						name: p.name,
						files: p.files,
						memory: typeof p.memory === "string" ? p.memory : undefined,
					});
				}
			}
		}
		const config: Config = {
			vault: expandHome(parsed.vault),
			core: parsed.core,
			projects,
		};
		return { config, warn: null };
	} catch (e: any) {
		if (e.code === "ENOENT") return { config: null, warn: `Config not found: ${configPath}` };
		return { config: null, warn: `Config error: ${e.message}` };
	}
}
