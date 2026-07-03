import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules } from "./index.ts";

function tmpSettings(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "safebash-"));
	const path = join(dir, "settings.json");
	writeFileSync(path, contents, "utf-8");
	return path;
}

test("fills missing fields when bashSafety is partial", () => {
	// Regression: a bashSafety with only allowlist left blocklist undefined,
	// crashing every command with "undefined is not an object".
	const path = tmpSettings(
		JSON.stringify({ bashSafety: { allowlist: ["ls *"] } }),
	);
	const rules = loadRules(path);
	expect(rules.blocklist).toEqual([]);
	expect(rules.allowlist).toEqual(["ls *"]);
	expect(rules.requireConfirmForUnknown).toBe(true);
});

test("returns defaults when bashSafety is absent", () => {
	const path = tmpSettings(JSON.stringify({ theme: "dark" }));
	expect(loadRules(path)).toEqual({
		blocklist: [],
		allowlist: [],
		requireConfirmForUnknown: true,
	});
});

test("returns defaults for a malformed settings file", () => {
	const path = tmpSettings("{ not json");
	expect(loadRules(path)).toEqual({
		blocklist: [],
		allowlist: [],
		requireConfirmForUnknown: true,
	});
});
