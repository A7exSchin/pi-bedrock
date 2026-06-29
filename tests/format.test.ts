import { describe, it, expect } from "vitest";
import type { LoadedFile } from "../extensions/types.js";
import { stripFrontMatter, formatSection } from "../extensions/format.js";

function file(rel: string, content: string): LoadedFile {
	return { rel, abs: `/abs/${rel}`, content };
}

describe("stripFrontMatter", () => {
	it("removes a leading YAML front-matter block", () => {
		const md = "---\ntype: note\ntags: [a]\n---\n\n# Title\n\nbody";
		expect(stripFrontMatter(md)).toBe("# Title\n\nbody");
	});

	it("returns content unchanged when there is no front matter", () => {
		expect(stripFrontMatter("# Title\n\nbody")).toBe("# Title\n\nbody");
	});

	it("returns content unchanged when the block is unterminated", () => {
		const md = "---\ntype: note\n# never closed";
		expect(stripFrontMatter(md)).toBe(md);
	});

	it("trims leading whitespace after the block", () => {
		const md = "---\nx: 1\n---\n\n\ncontent";
		expect(stripFrontMatter(md)).toBe("content");
	});
});

describe("formatSection", () => {
	it("returns empty string for no files", () => {
		expect(formatSection("Title", [])).toBe("");
	});

	it("renders a single file with title and rel heading", () => {
		const out = formatSection("Core", [file("a.md", "hello")]);
		expect(out).toContain("# Core");
		expect(out).toContain("## a.md");
		expect(out).toContain("hello");
	});

	it("joins multiple files with a separator", () => {
		const out = formatSection("Core", [file("a.md", "A"), file("b.md", "B")]);
		expect(out).toContain("## a.md");
		expect(out).toContain("## b.md");
		expect(out).toContain("---");
	});

	it("strips front matter from rendered content", () => {
		const out = formatSection("Core", [file("a.md", "---\nx: 1\n---\n\nbody")]);
		expect(out).toContain("body");
		expect(out).not.toContain("x: 1");
	});
});
