import { main } from "@earendil-works/pi-coding-agent";
import { setBedrockProviderModule } from "@earendil-works/pi-ai";
import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
setBedrockProviderModule(bedrockProviderModule);
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

const cliArgs = process.argv.slice(2);

// Honour Claude Code env vars that pi doesn't natively understand.
// Inject --model <ANTHROPIC_MODEL> unless the caller already passed --model.
const anthropicModel = process.env.ANTHROPIC_MODEL;
if (anthropicModel && !cliArgs.includes("--model")) {
	cliArgs.unshift("--model", anthropicModel);
}

await main(cliArgs, {
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
