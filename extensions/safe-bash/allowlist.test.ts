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
