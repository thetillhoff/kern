import { appendJsonl } from "../shared/append-jsonl.ts";

export interface CompactionEvent {
	ts: string;
	session: string;
	tokensBefore: number;
	tokensLimit: number;
	trigger: "auto";
}

export function appendCompactionLog(
	logPath: string,
	entry: CompactionEvent,
): void {
	appendJsonl(logPath, entry);
}
