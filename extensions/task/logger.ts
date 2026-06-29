import { appendJsonl } from "../shared/append-jsonl.ts";

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
	appendJsonl(logPath, entry);
}
