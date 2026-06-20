import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadPIMd } from "./loader.ts";

export default function (pi: ExtensionAPI) {
	const globalDir = join(homedir(), ".pi");

	pi.on("before_agent_start", async (event, ctx) => {
		const content = loadPIMd(ctx.cwd, globalDir);
		if (content) {
			(event as unknown as { systemPrompt: string }).systemPrompt =
				((event as unknown as { systemPrompt?: string }).systemPrompt ?? "") +
				"\n\n" +
				content;
		}
	});
}
