import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readFile, readFiles, readMemoryDir, findMissingFiles } from "../extensions/files.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bedrock-files-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readFile", () => {
	it("returns content for an existing file", () => {
		const f = path.join(tmpDir, "x.md");
		fs.writeFileSync(f, "hello");
		expect(readFile(f)).toBe("hello");
	});

	it("returns null for a missing file", () => {
		expect(readFile(path.join(tmpDir, "nope.md"))).toBeNull();
	});
});

describe("readFiles", () => {
	it("loads existing files and skips missing ones", () => {
		fs.writeFileSync(path.join(tmpDir, "a.md"), "A");
		fs.writeFileSync(path.join(tmpDir, "b.md"), "B");
		const loaded = readFiles(tmpDir, ["a.md", "missing.md", "b.md"]);
		expect(loaded).toHaveLength(2);
		expect(loaded.map((f) => f.rel)).toEqual(["a.md", "b.md"]);
		expect(loaded[0].content).toBe("A");
	});

	it("returns empty array when nothing exists", () => {
		expect(readFiles(tmpDir, ["x.md"])).toHaveLength(0);
	});
});

describe("readMemoryDir", () => {
	it("loads only .md files from the directory", () => {
		const mem = path.join(tmpDir, "mem");
		fs.mkdirSync(mem);
		fs.writeFileSync(path.join(mem, "one.md"), "1");
		fs.writeFileSync(path.join(mem, "two.md"), "2");
		fs.writeFileSync(path.join(mem, "ignore.txt"), "x");
		const loaded = readMemoryDir(tmpDir, "mem");
		expect(loaded).toHaveLength(2);
		expect(loaded.every((f) => f.rel.endsWith(".md"))).toBe(true);
	});

	it("ignores subdirectories (non-recursive)", () => {
		const mem = path.join(tmpDir, "mem");
		fs.mkdirSync(path.join(mem, "sub"), { recursive: true });
		fs.writeFileSync(path.join(mem, "top.md"), "t");
		fs.writeFileSync(path.join(mem, "sub", "nested.md"), "n");
		const loaded = readMemoryDir(tmpDir, "mem");
		expect(loaded).toHaveLength(1);
		expect(loaded[0].rel).toBe(path.join("mem", "top.md"));
	});

	it("returns empty array for a missing directory", () => {
		expect(readMemoryDir(tmpDir, "nope")).toHaveLength(0);
	});
});

describe("findMissingFiles", () => {
	it("returns empty array when all files exist", () => {
		fs.writeFileSync(path.join(tmpDir, "a.md"), "A");
		fs.writeFileSync(path.join(tmpDir, "b.md"), "B");
		expect(findMissingFiles(tmpDir, ["a.md", "b.md"])).toEqual([]);
	});

	it("returns relative paths of missing files", () => {
		fs.writeFileSync(path.join(tmpDir, "exists.md"), "ok");
		const missing = findMissingFiles(tmpDir, ["exists.md", "gone.md", "also-gone.md"]);
		expect(missing).toEqual(["gone.md", "also-gone.md"]);
	});

	it("returns all paths when none exist", () => {
		const missing = findMissingFiles(tmpDir, ["x.md", "y.md"]);
		expect(missing).toEqual(["x.md", "y.md"]);
	});

	it("returns empty array for empty input", () => {
		expect(findMissingFiles(tmpDir, [])).toEqual([]);
	});
});
