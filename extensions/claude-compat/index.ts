import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPIMd } from "./loader.ts";
import { claudeSkillPaths } from "./skills.ts";

export default function (pi: ExtensionAPI) {
	const globalPiDir = join(homedir(), ".pi");
	const globalClaudeDir = join(homedir(), ".claude");

	pi.on("before_agent_start", async (event, ctx) => {
		// globalClaudeDir intentionally omitted: loader.ts skips ~/.claude/CLAUDE.md
		// when no directory is provided, preventing Claude Code harness config injection.
		const content = loadPIMd(ctx.cwd, globalPiDir);
		if (!content) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${content}` };
	});

	pi.on("resources_discover", async (event) => {
		return { skillPaths: claudeSkillPaths(event.cwd, globalClaudeDir) };
	});
}
