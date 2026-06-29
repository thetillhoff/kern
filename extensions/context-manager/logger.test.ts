import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCompactionLog } from "./logger.ts";

let tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs = [];
});

test("writes valid JSONL line", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
	tmpDirs.push(dir);
	const logPath = join(dir, "compaction.jsonl");
	const entry = {
		ts: "2026-01-01T00:00:00Z",
		session: "main",
		tokensBefore: 80000,
		tokensLimit: 100000,
		trigger: "auto" as const,
	};
	appendCompactionLog(logPath, entry);
	expect(JSON.parse(readFileSync(logPath, "utf-8").trim())).toMatchObject(
		entry,
	);
});

test("appends without overwriting", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
	tmpDirs.push(dir);
	const logPath = join(dir, "compaction.jsonl");
	appendCompactionLog(logPath, {
		ts: "t1",
		session: "s",
		tokensBefore: 1,
		tokensLimit: 100,
		trigger: "auto",
	});
	appendCompactionLog(logPath, {
		ts: "t2",
		session: "s",
		tokensBefore: 2,
		tokensLimit: 100,
		trigger: "auto",
	});
	const lines = readFileSync(logPath, "utf-8").trim().split("\n");
	expect(lines).toHaveLength(2);
});
