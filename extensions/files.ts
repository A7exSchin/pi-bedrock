import * as fs from "node:fs";
import * as path from "node:path";
import type { LoadedFile } from "./types.js";

export function readFile(abs: string): string | null {
	try {
		return fs.readFileSync(abs, "utf-8");
	} catch {
		return null;
	}
}

export function readFiles(root: string, relatives: string[]): LoadedFile[] {
	const results: LoadedFile[] = [];
	for (const rel of relatives) {
		const abs = path.join(root, rel);
		const content = readFile(abs);
		if (content !== null) {
			results.push({ rel, abs, content });
		}
	}
	return results;
}

export function readMemoryDir(root: string, memDir: string): LoadedFile[] {
	const abs = path.join(root, memDir);
	try {
		const entries = fs.readdirSync(abs, { withFileTypes: true });
		const files: LoadedFile[] = [];
		for (const e of entries) {
			if (!e.isFile() || !e.name.endsWith(".md")) continue;
			const rel = path.join(memDir, e.name);
			const filePath = path.join(abs, e.name);
			const content = readFile(filePath);
			if (content !== null) files.push({ rel, abs: filePath, content });
		}
		return files;
	} catch {
		return [];
	}
}
