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

test("returns empty string when no files exist", () => {
	expect(
		loadPIMd("/nonexistent", "/also/nonexistent", "/also/nonexistent"),
	).toBe("");
});

test("loads global PI.md only", () => {
	const globalPiDir = makeTmp();
	writeFileSync(join(globalPiDir, "PI.md"), "Global PI");
	expect(loadPIMd("/nonexistent/project", globalPiDir, "/nonexistent")).toBe(
		"Global PI",
	);
});

test("loads global CLAUDE.md only", () => {
	const globalClaudeDir = makeTmp();
	writeFileSync(join(globalClaudeDir, "CLAUDE.md"), "Global Claude");
	expect(
		loadPIMd("/nonexistent/project", "/nonexistent", globalClaudeDir),
	).toBe("Global Claude");
});

test("loads local PI.md only", () => {
	const localDir = makeTmp();
	mkdirSync(join(localDir, ".pi"));
	writeFileSync(join(localDir, ".pi", "PI.md"), "Local PI");
	expect(loadPIMd(localDir, "/nonexistent", "/nonexistent")).toBe("Local PI");
});

test("loads local CLAUDE.md only", () => {
	const localDir = makeTmp();
	mkdirSync(join(localDir, ".claude"));
	writeFileSync(join(localDir, ".claude", "CLAUDE.md"), "Local Claude");
	expect(loadPIMd(localDir, "/nonexistent", "/nonexistent")).toBe(
		"Local Claude",
	);
});

test("joins all four in order with separator", () => {
	const globalPiDir = makeTmp();
	const globalClaudeDir = makeTmp();
	const localDir = makeTmp();

	writeFileSync(join(globalPiDir, "PI.md"), "Global PI");
	writeFileSync(join(globalClaudeDir, "CLAUDE.md"), "Global Claude");
	mkdirSync(join(localDir, ".pi"));
	writeFileSync(join(localDir, ".pi", "PI.md"), "Local PI");
	mkdirSync(join(localDir, ".claude"));
	writeFileSync(join(localDir, ".claude", "CLAUDE.md"), "Local Claude");

	expect(loadPIMd(localDir, globalPiDir, globalClaudeDir)).toBe(
		"Global PI\n\n---\n\nGlobal Claude\n\n---\n\nLocal PI\n\n---\n\nLocal Claude",
	);
});

test("trims whitespace from file content", () => {
	const globalPiDir = makeTmp();
	writeFileSync(join(globalPiDir, "PI.md"), "  Global  \n\n");
	expect(loadPIMd("/nonexistent", globalPiDir, "/nonexistent")).toBe("Global");
});
