import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RouterDecision {
	ts: string;
	session: string;
	tier: string;
	model: string;
	reason: "explicit" | "ollama" | "fallback" | "ollama-late";
	latencyMs: number;
}

export function appendDecision(logPath: string, entry: RouterDecision): void {
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
