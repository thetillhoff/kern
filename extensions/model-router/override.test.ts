import { afterEach, expect, test } from "bun:test";
import {
	clearStore,
	isPinned,
	noteRouterSet,
	pinSession,
	setTierOverride,
	takeTierOverride,
	wasRouterSet,
} from "./override.ts";

afterEach(() => {
	clearStore();
});

test("takeTierOverride returns then clears the override", () => {
	setTierOverride("s1", "heavy");
	expect(takeTierOverride("s1")).toBe("heavy");
	expect(takeTierOverride("s1")).toBeUndefined();
});

test("pinSession marks a session pinned", () => {
	expect(isPinned("s2")).toBe(false);
	pinSession("s2");
	expect(isPinned("s2")).toBe(true);
});

test("wasRouterSet matches only the last router-set model for a session", () => {
	noteRouterSet("s3", "haiku");
	expect(wasRouterSet("s3", "haiku")).toBe(true);
	expect(wasRouterSet("s3", "opus")).toBe(false);
});
