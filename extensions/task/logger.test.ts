import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSubagentLog } from "./logger.ts";

test("appends one JSON line per event", () => {
	const path = join(mkdtempSync(join(tmpdir(), "subagent-")), "subagent.jsonl");
	appendSubagentLog(path, {
		ts: "2026-06-21T00:00:00.000Z",
		parentSession: "p1",
		childSession: "c1",
		model: "haiku",
		tokens: 1234,
		status: "completed",
		durationMs: 4200,
	});
	const lines = readFileSync(path, "utf-8").trim().split("\n");
	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0]).status).toBe("completed");
	expect(JSON.parse(lines[0]).tokens).toBe(1234);
});
