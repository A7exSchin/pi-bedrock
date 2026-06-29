import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { expandHome, isInsidePath } from "../extensions/paths.js";

describe("expandHome", () => {
	it("expands bare ~", () => {
		expect(expandHome("~")).toBe(os.homedir());
	});

	it("expands ~/subpath", () => {
		expect(expandHome("~/foo/bar")).toBe(path.join(os.homedir(), "foo/bar"));
	});

	it("leaves absolute paths unchanged", () => {
		expect(expandHome("/usr/bin")).toBe("/usr/bin");
	});

	it("leaves relative paths unchanged", () => {
		expect(expandHome("foo/bar")).toBe("foo/bar");
	});

	it("does not expand ~user form", () => {
		expect(expandHome("~other/foo")).toBe("~other/foo");
	});
});

describe("isInsidePath", () => {
	it("returns true for exact match", () => {
		expect(isInsidePath("/foo/bar", "/foo/bar")).toBe(true);
	});

	it("returns true for a child path", () => {
		expect(isInsidePath("/foo/bar/baz", "/foo/bar")).toBe(true);
	});

	it("returns false for a sibling with shared prefix", () => {
		expect(isInsidePath("/foo/bar-extra", "/foo/bar")).toBe(false);
	});

	it("returns false for a parent", () => {
		expect(isInsidePath("/foo", "/foo/bar")).toBe(false);
	});

	it("returns false for unrelated paths", () => {
		expect(isInsidePath("/other", "/foo/bar")).toBe(false);
	});

	it("resolves relative segments before comparing", () => {
		expect(isInsidePath("/foo/bar/../bar/baz", "/foo/bar")).toBe(true);
	});
});
