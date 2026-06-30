import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { main } from "@earendil-works/pi-coding-agent";
import claudeCompat from "./extensions/claude-compat/index.ts";
import contextManager from "./extensions/context-manager/index.ts";
import fetchUrl from "./extensions/fetch-url/index.ts";
import mcpIntegration from "./extensions/mcp-integration/index.ts";
import modelRouter from "./extensions/model-router/index.ts";
import safeBash from "./extensions/safe-bash/index.ts";
import task from "./extensions/task/index.ts";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

if (process.argv[2] === "--version" || process.argv[2] === "-v") {
	console.log(VERSION);
	process.exit(0);
}

// Resolve config dir: prefer existing .pi or .claude/kern agent dir, else default .kern
if (!process.env.KERN_CODING_AGENT_DIR) {
	const home = homedir();
	const piAgent = join(home, ".pi", "agent");
	const claudeAgent = join(home, ".claude", "kern");
	if (existsSync(piAgent)) {
		process.env.KERN_CODING_AGENT_DIR = piAgent;
	} else if (existsSync(claudeAgent)) {
		process.env.KERN_CODING_AGENT_DIR = claudeAgent;
	}
	// else: falls back to ~/.kern/agent via package.json piConfig.configDir
}

await main(process.argv.slice(2), {
	extensionFactories: [
		claudeCompat,
		contextManager,
		fetchUrl,
		mcpIntegration,
		modelRouter,
		safeBash,
		task,
	],
});
