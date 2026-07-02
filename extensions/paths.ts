import * as os from "node:os";
import * as path from "node:path";

export const HOME = os.homedir();

/** Expand a leading ~ to the home directory. */
export function expandHome(p: string): string {
	if (p === "~") return HOME;
	if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
	return p;
}

/** Shorten an absolute path by replacing the home directory with ~. */
export function shortenHome(p: string): string {
	if (p === HOME) return "~";
	if (p.startsWith(HOME + "/")) return "~" + p.slice(HOME.length);
	return p;
}

/** True if `cwd` is `dir` itself or lives inside it. */
export function isInsidePath(cwd: string, dir: string): boolean {
	const resolved = path.resolve(cwd);
	const dirResolved = path.resolve(dir);
	return resolved === dirResolved || resolved.startsWith(dirResolved + path.sep);
}
