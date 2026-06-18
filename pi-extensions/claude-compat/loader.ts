import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadPIMd(cwd: string, globalDir?: string): string {
  const parts: string[] = [];
  const home = globalDir ?? join(homedir(), ".pi");

  const globalPath = join(home, "PI.md");
  if (existsSync(globalPath)) {
    parts.push(readFileSync(globalPath, "utf-8").trim());
  }

  const localPath = join(cwd, ".pi", "PI.md");
  if (existsSync(localPath)) {
    parts.push(readFileSync(localPath, "utf-8").trim());
  }

  return parts.join("\n\n---\n\n");
}
