export interface ProjectConfig {
	/** Directory path (~ expanded). Files injected when cwd is inside this path. */
	path: string;
	/** Display name for status/list output. Defaults to directory basename. */
	name?: string;
	/** Root directory for resolving `files` and `memory`. Defaults to `path`. */
	root?: string;
	/** Files relative to `root` (or `path` if root is unset). */
	files: string[];
	/** Optional memory directory relative to `root` (or `path`) — all .md files scanned. */
	memory?: string;
}

export interface ModeConfig {
	/**
	 * Files relative to the vault root, injected compaction-proof for the whole
	 * session while this mode is active. May be empty (mode injects nothing).
	 */
	files: string[];
}

export interface Config {
	/** Absolute path to the vault root (~ expanded). Root for core files. */
	vault: string;
	/** Files relative to vault root — injected every session regardless of cwd. */
	core: string[];
	/** Project-scoped context — injected when cwd is inside project path. */
	projects: ProjectConfig[];
	/**
	 * Session modes, keyed by mode name. A mode is bound to a session at start
	 * (while empty) and immutable thereafter; its files inject for the whole
	 * session. Files resolve relative to `vault`.
	 */
	modes: Record<string, ModeConfig>;
}

export interface LoadedFile {
	rel: string;
	abs: string;
	content: string;
}

export interface LoadResult {
	config: Config | null;
	warn: string | null;
	/** Non-fatal warnings (e.g. a mode name colliding with a reserved subcommand). */
	notes: string[];
}
