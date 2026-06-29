import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision } from "./logger.ts";

let tmpDirs: string[] = [];
afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs = [];
});

test("writes valid JSONL line", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
	tmpDirs.push(dir);
	const logPath = join(dir, "model-decisions.jsonl");
	const entry = {
		ts: "2026-01-01T00:00:00Z",
		session: "main",
		tier: "local",
		model: "qwen3:4b",
		reason: "ollama" as const,
		latencyMs: 5,
	};
	appendDecision(logPath, entry);
	const line = readFileSync(logPath, "utf-8").trim();
	expect(JSON.parse(line)).toMatchObject(entry);
});

test("appends multiple lines", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
	tmpDirs.push(dir);
	const logPath = join(dir, "decisions.jsonl");
	appendDecision(logPath, {
		ts: "t1",
		session: "s",
		tier: "local",
		model: "m",
		reason: "explicit",
		latencyMs: 1,
	});
	appendDecision(logPath, {
		ts: "t2",
		session: "s",
		tier: "heavy",
		model: "m2",
		reason: "ollama",
		latencyMs: 200,
	});
	const lines = readFileSync(logPath, "utf-8").trim().split("\n");
	expect(lines).toHaveLength(2);
	expect(JSON.parse(lines[1]).tier).toBe("heavy");
});

test("creates parent directories", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
	tmpDirs.push(dir);
	const logPath = join(dir, "nested", "deep", "log.jsonl");
	appendDecision(logPath, {
		ts: "t",
		session: "s",
		tier: "local",
		model: "m",
		reason: "fallback",
		latencyMs: 0,
	});
	const line = readFileSync(logPath, "utf-8").trim();
	expect(JSON.parse(line).tier).toBe("local");
});
