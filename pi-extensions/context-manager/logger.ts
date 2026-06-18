import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CompactionEvent {
  ts: string;
  session: string;
  tokensBefore: number;
  tokensLimit: number;
  trigger: "auto";
}

export function appendCompactionLog(logPath: string, entry: CompactionEvent): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
