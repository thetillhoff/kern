import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPIMd } from "./loader.ts";

let tmpDirs: string[] = [];
function makeTmp(): string {
	const d = mkdtempSync(join(tmpdir(), "pi-compat-"));
	tmpDirs.push(d);
	return d;
}

afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs = [];
});

test("returns empty string when no PI.md files exist", () => {
	expect(loadPIMd("/nonexistent", "/also/nonexistent")).toBe("");
});

test("loads global PI.md only", () => {
	const globalDir = makeTmp();
	writeFileSync(join(globalDir, "PI.md"), "Global instructions");
	expect(loadPIMd("/nonexistent/project", globalDir)).toBe(
		"Global instructions",
	);
});

test("loads local PI.md only", () => {
	const localDir = makeTmp();
	mkdirSync(join(localDir, ".pi"));
	writeFileSync(join(localDir, ".pi", "PI.md"), "Local instructions");
	expect(loadPIMd(localDir, "/nonexistent/global")).toBe("Local instructions");
});

test("joins both with separator, global first", () => {
	const globalDir = makeTmp();
	const localDir = makeTmp();
	writeFileSync(join(globalDir, "PI.md"), "Global");
	mkdirSync(join(localDir, ".pi"));
	writeFileSync(join(localDir, ".pi", "PI.md"), "Local");
	expect(loadPIMd(localDir, globalDir)).toBe("Global\n\n---\n\nLocal");
});

test("trims whitespace from file content", () => {
	const globalDir = makeTmp();
	writeFileSync(join(globalDir, "PI.md"), "  Global  \n\n");
	expect(loadPIMd("/nonexistent", globalDir)).toBe("Global");
});
