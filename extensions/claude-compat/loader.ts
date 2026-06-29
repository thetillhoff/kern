import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadPIMd(
	cwd: string,
	globalPiDir?: string,
	globalClaudeDir?: string,
): string {
	const parts: string[] = [];
	const home = homedir();

	// Only include the global CLAUDE.md when an explicit directory is provided.
	// Defaulting to ~/.claude/CLAUDE.md would inject Claude Code harness config
	// (tool permissions, editor settings) that is not intended for the pi agent.
	const globalClaude = globalClaudeDir
		? join(globalClaudeDir, "CLAUDE.md")
		: null;

	for (const p of [
		join(globalPiDir ?? join(home, ".pi"), "PI.md"),
		...(globalClaude ? [globalClaude] : []),
		join(cwd, ".pi", "PI.md"),
		join(cwd, ".claude", "CLAUDE.md"),
	]) {
		if (existsSync(p)) parts.push(readFileSync(p, "utf-8").trim());
	}

	return parts.join("\n\n---\n\n");
}
