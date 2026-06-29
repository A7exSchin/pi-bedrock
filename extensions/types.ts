export interface ProjectConfig {
	/** Directory path (~ expanded). Files injected when cwd is inside this path. */
	path: string;
	/** Display name for status/list output. Defaults to directory basename. */
	name?: string;
	/** Files relative to project path — injected when cwd is inside project. */
	files: string[];
	/** Optional memory directory relative to project path — all .md files scanned. */
	memory?: string;
}

export interface Config {
	/** Absolute path to the vault root (~ expanded). Root for core files. */
	vault: string;
	/** Files relative to vault root — injected every session regardless of cwd. */
	core: string[];
	/** Project-scoped context — injected when cwd is inside project path. */
	projects: ProjectConfig[];
}

export interface LoadedFile {
	rel: string;
	abs: string;
	content: string;
}

export interface LoadResult {
	config: Config | null;
	warn: string | null;
}
