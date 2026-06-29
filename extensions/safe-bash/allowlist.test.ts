import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAllowlistPattern } from "./allowlist.ts";

function tmpSettings(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "safebash-"));
	const path = join(dir, "settings.json");
	writeFileSync(path, contents, "utf-8");
	return path;
}

test("appends a new pattern to an existing allowlist", () => {
	const path = tmpSettings(
		JSON.stringify({ bashSafety: { allowlist: ["ls *"] } }),
	);
	appendAllowlistPattern(path, "git *");
	const after = JSON.parse(readFileSync(path, "utf-8"));
	expect(after.bashSafety.allowlist).toEqual(["ls *", "git *"]);
});

test("creates the bashSafety structure when missing", () => {
	const path = tmpSettings(JSON.stringify({ theme: "dark" }));
	appendAllowlistPattern(path, "git *");
	const after = JSON.parse(readFileSync(path, "utf-8"));
	expect(after.theme).toBe("dark");
	expect(after.bashSafety.allowlist).toEqual(["git *"]);
});

test("is a no-op when the pattern already exists", () => {
	const path = tmpSettings(
		JSON.stringify({ bashSafety: { allowlist: ["git *"] } }),
	);
	appendAllowlistPattern(path, "git *");
	const after = JSON.parse(readFileSync(path, "utf-8"));
	expect(after.bashSafety.allowlist).toEqual(["git *"]);
});

test("creates a new file when the settings path does not exist", () => {
	const dir = mkdtempSync(join(tmpdir(), "safebash-"));
	const path = join(dir, "settings.json");
	appendAllowlistPattern(path, "git *");
	const after = JSON.parse(readFileSync(path, "utf-8"));
	expect(after).toEqual({ bashSafety: { allowlist: ["git *"] } });
});

test("leaves a malformed settings file byte-for-byte unchanged", () => {
	const malformed = "{ not json";
	const path = tmpSettings(malformed);
	appendAllowlistPattern(path, "git *");
	const after = readFileSync(path, "utf-8");
	expect(after).toBe(malformed);
});
