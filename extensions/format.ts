import type { LoadedFile } from "./types.js";

/** Strip a leading YAML front-matter block (--- ... ---) from markdown. */
export function stripFrontMatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).trimStart();
}

/** Render a titled section of files, or "" when there are none. */
export function formatSection(title: string, files: LoadedFile[]): string {
	if (files.length === 0) return "";
	const parts = files.map((f) => `## ${f.rel}\n\n${stripFrontMatter(f.content).trim()}`);
	return `\n# ${title}\n\n${parts.join("\n\n---\n\n")}`;
}
