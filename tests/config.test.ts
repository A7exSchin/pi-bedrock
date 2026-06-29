import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../extensions/config.js";

let tmpDir: string;
let configPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bedrock-test-"));
	configPath = path.join(tmpDir, "pi-bedrock.json");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(data: unknown) {
	fs.writeFileSync(configPath, typeof data === "string" ? data : JSON.stringify(data));
}

describe("loadConfig", () => {
	it("warns when the config is missing", () => {
		const { config, warn } = loadConfig(configPath);
		expect(config).toBeNull();
		expect(warn).toContain("Config not found");
	});

	it("warns on invalid JSON", () => {
		writeConfig("not json {{{");
		const { config, warn } = loadConfig(configPath);
		expect(config).toBeNull();
		expect(warn).toContain("Config error");
	});

	it("warns when required fields are missing", () => {
		writeConfig({ projects: [] });
		const { config, warn } = loadConfig(configPath);
		expect(config).toBeNull();
		expect(warn).toContain("missing required fields");
	});

	it("loads a minimal valid config", () => {
		writeConfig({ vault: "/tmp/vault", core: ["a.md", "b.md"] });
		const { config, warn } = loadConfig(configPath);
		expect(warn).toBeNull();
		expect(config?.vault).toBe("/tmp/vault");
		expect(config?.core).toHaveLength(2);
		expect(config?.projects).toHaveLength(0);
	});

	it("expands ~ in vault and project paths", () => {
		writeConfig({
			vault: "~/vault",
			core: ["a.md"],
			projects: [{ path: "~/proj", files: ["x.md"] }],
		});
		const { config } = loadConfig(configPath);
		expect(config?.vault).toBe(path.join(os.homedir(), "vault"));
		expect(config?.projects[0].path).toBe(path.join(os.homedir(), "proj"));
	});

	it("drops projects missing path or files", () => {
		writeConfig({
			vault: "/v",
			core: ["a.md"],
			projects: [{ path: "/ok", files: ["x.md"] }, { name: "bad" }, { path: "/np" }],
		});
		const { config } = loadConfig(configPath);
		expect(config?.projects).toHaveLength(1);
		expect(config?.projects[0].path).toBe("/ok");
	});

	it("keeps memory only when it is a string", () => {
		writeConfig({
			vault: "/v",
			core: ["a.md"],
			projects: [
				{ path: "/a", files: [], memory: "mem/" },
				{ path: "/b", files: [], memory: 42 },
			],
		});
		const { config } = loadConfig(configPath);
		expect(config?.projects[0].memory).toBe("mem/");
		expect(config?.projects[1].memory).toBeUndefined();
	});
});
