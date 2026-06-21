import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendAllowlistPattern } from "./allowlist.ts";
import { matchesAny, suggestPattern } from "./rules.ts";

interface BashSafetyRules {
	blocklist: string[];
	allowlist: string[];
	requireConfirmForUnknown: boolean;
}

function loadRules(settingsPath: string): BashSafetyRules {
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		return (
			settings.bashSafety ?? {
				blocklist: [],
				allowlist: [],
				requireConfirmForUnknown: true,
			}
		);
	} catch {
		return { blocklist: [], allowlist: [], requireConfirmForUnknown: true };
	}
}

export default function (pi: ExtensionAPI) {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command: string =
			(event.input as { command?: string })?.command ?? "";
		const rules = loadRules(settingsPath);

		if (matchesAny(command, rules.blocklist)) {
			ctx.ui.notify(`Blocked: ${command.slice(0, 80)}`, "error");
			return { block: true, reason: "Command matches blocklist" };
		}

		if (matchesAny(command, rules.allowlist)) {
			return; // pre-approved
		}

		if (rules.requireConfirmForUnknown) {
			const choice = await ctx.ui.select(
				"Bash approval required",
				["Allow once", "Allow always", "Deny"],
				{},
			);
			if (choice === "Allow always") {
				const edited = await ctx.ui.editor(
					"Allowlist pattern (edit before saving)",
					suggestPattern(command),
				);
				if (edited?.trim()) {
					appendAllowlistPattern(settingsPath, edited.trim());
					return; // approved and persisted
				}
				return { block: true, reason: "User cancelled allow-always" };
			}
			if (choice !== "Allow once") {
				return { block: true, reason: "User denied" };
			}
		}
	});
}
