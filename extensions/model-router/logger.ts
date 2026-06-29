import { appendJsonl } from "../shared/append-jsonl.ts";

export interface RouterDecision {
	ts: string;
	session: string;
	tier: string;
	model: string;
	reason: "explicit" | "ollama" | "fallback" | "ollama-late";
	latencyMs: number;
}

export function appendDecision(logPath: string, entry: RouterDecision): void {
	appendJsonl(logPath, entry);
}
