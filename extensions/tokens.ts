import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
	if (!encoder) {
		encoder = new Tiktoken(o200k_base);
	}
	return encoder;
}

/** Count tokens using the o200k_base BPE tokenizer. */
export function estimateTokens(text: string): number {
	return getEncoder().encode(text).length;
}

/** Format token count for display (e.g. "~2.4k tokens" or "~380 tokens"). */
export function formatTokens(tokens: number): string {
	if (tokens >= 1000) return `~${(tokens / 1000).toFixed(1)}k tokens`;
	return `~${tokens} tokens`;
}
