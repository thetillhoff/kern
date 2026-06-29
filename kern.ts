import { main } from "@earendil-works/pi-coding-agent";
import claudeCompat from "./extensions/claude-compat/index.ts";
import contextManager from "./extensions/context-manager/index.ts";
import fetchUrl from "./extensions/fetch-url/index.ts";
import mcpIntegration from "./extensions/mcp-integration/index.ts";
import modelRouter from "./extensions/model-router/index.ts";
import safeBash from "./extensions/safe-bash/index.ts";
import task from "./extensions/task/index.ts";

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
