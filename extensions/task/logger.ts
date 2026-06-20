import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SubagentStatus =
	| "spawned"
	| "asked"
	| "answered"
	| "completed"
	| "aborted"
	| "timeout";

export interface SubagentEvent {
	ts: string;
	parentSession: string;
	childSession: string;
	model: string;
	tokens: number;
	status: SubagentStatus;
	durationMs: number;
}

export function appendSubagentLog(logPath: string, entry: SubagentEvent): void {
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
