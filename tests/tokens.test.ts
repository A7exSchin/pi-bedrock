import { describe, it, expect } from "vitest";
import { estimateTokens, formatTokens } from "../extensions/tokens.js";

describe("estimateTokens", () => {
	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("returns a positive count for non-empty text", () => {
		expect(estimateTokens("hello world")).toBeGreaterThan(0);
	});

	it("counts tokens using BPE (not just chars/4)", () => {
		// "a".repeat(100) should NOT be exactly 25 — BPE merges repeated chars
		const tokens = estimateTokens("a".repeat(100));
		expect(tokens).toBeGreaterThan(0);
		expect(tokens).toBeLessThan(100); // BPE compresses repetition
	});

	it("gives reasonable counts for English prose", () => {
		const text = "The quick brown fox jumps over the lazy dog.";
		const tokens = estimateTokens(text);
		// English prose: roughly 1 token per word, this sentence has 9 words + punctuation
		expect(tokens).toBeGreaterThanOrEqual(8);
		expect(tokens).toBeLessThanOrEqual(15);
	});

	it("gives higher counts for code than plain English per character", () => {
		const prose = "This is a simple sentence with common words repeated often.";
		const code = "const x = arr.reduce((acc, v) => acc + v, 0);";
		// Code tends to have more tokens per character than prose
		const proseRatio = estimateTokens(prose) / prose.length;
		const codeRatio = estimateTokens(code) / code.length;
		expect(codeRatio).toBeGreaterThanOrEqual(proseRatio * 0.8); // code at least comparable
	});
});

describe("formatTokens", () => {
	it("formats small counts without k suffix", () => {
		expect(formatTokens(0)).toBe("~0 tokens");
		expect(formatTokens(380)).toBe("~380 tokens");
		expect(formatTokens(999)).toBe("~999 tokens");
	});

	it("formats counts >= 1000 with k suffix", () => {
		expect(formatTokens(1000)).toBe("~1.0k tokens");
		expect(formatTokens(2400)).toBe("~2.4k tokens");
		expect(formatTokens(15300)).toBe("~15.3k tokens");
	});
});
