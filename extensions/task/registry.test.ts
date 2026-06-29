import { expect, test } from "bun:test";
import {
	augmentTools,
	type ChildEntry,
	deferred,
	descendantsOf,
	formatTokens,
	registry,
	rowText,
	subtreeRows,
} from "./registry.ts";

function fakeEntry(over: Partial<ChildEntry>): ChildEntry {
	return {
		model: "m",
		tokensTotal: 0,
		status: "running",
		...over,
	} as unknown as ChildEntry;
}

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

test("subtreeRows nests descendants under the root with increasing depth", () => {
	registry.clear();
	registry.set("root0000", fakeEntry({ status: "running" }));
	registry.set("child000", fakeEntry({ parentId: "root0000" }));
	registry.set("grand000", fakeEntry({ parentId: "child000" }));
	registry.set("other000", fakeEntry({ parentId: "elsewhere" }));

	const rows = subtreeRows("root0000");
	expect(rows.map((r) => [r.name, r.depth])).toEqual([
		["root0000", 0],
		["child000", 1],
		["grand000", 2],
	]);
	registry.clear();
});

test("descendantsOf collects nested children but not unrelated entries", () => {
	registry.clear();
	registry.set("child000", fakeEntry({ parentId: "parent00" }));
	registry.set("grand000", fakeEntry({ parentId: "child000" }));
	registry.set("other000", fakeEntry({ parentId: "elsewhere" }));

	expect(descendantsOf("parent00").sort()).toEqual(["child000", "grand000"]);
	expect(descendantsOf("nobody00")).toEqual([]);
	registry.clear();
});

test("rowText indents by depth and shows the running action", () => {
	const line = rowText({
		name: "abcd1234",
		model: "heavy",
		tokens: 1500,
		status: "running",
		note: "read",
		depth: 1,
	});
	expect(line).toBe("  abcd1234  heavy  1.5k tok  ⏵ running  read");
});

test("rowText omits the note for terminal states", () => {
	const line = rowText({
		name: "abcd1234",
		model: "heavy",
		tokens: 0,
		status: "done",
		note: "read",
		depth: 0,
	});
	expect(line).toBe("abcd1234  heavy  0 tok  ✓ done");
});
