import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function appendJsonl(logPath: string, entry: unknown): void {
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
