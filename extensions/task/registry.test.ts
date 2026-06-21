import { expect, test } from "bun:test";
import { augmentTools, deferred, formatTokens } from "./registry.ts";

test("deferred resolves with the supplied value", async () => {
	const d = deferred<string>();
	queueMicrotask(() => d.resolve("hi"));
	expect(await d.promise).toBe("hi");
});

test("formatTokens uses a compact k form above 1000", () => {
	expect(formatTokens(900)).toBe("900");
	expect(formatTokens(1234)).toBe("1.2k");
	expect(formatTokens(15564)).toBe("15.6k");
});

test("augmentTools keeps defaults when no allowlist", () => {
	expect(augmentTools(undefined)).toBeUndefined();
});

test("augmentTools injects ask-caller and task into an allowlist", () => {
	// biome-ignore lint/style/noNonNullAssertion: tools is defined, result is defined
	expect(augmentTools(["read"])!.sort()).toEqual([
		"ask-caller",
		"read",
		"task",
	]);
});

test("augmentTools does not duplicate existing entries", () => {
	// biome-ignore lint/style/noNonNullAssertion: tools is defined, result is defined
	expect(augmentTools(["ask-caller", "task"])!.sort()).toEqual([
		"ask-caller",
		"task",
	]);
});
