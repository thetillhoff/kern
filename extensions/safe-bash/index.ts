import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { queuedSelect } from "../shared/permission-queue.ts";
import { appendAllowlistPattern } from "./allowlist.ts";
import {
	isValidPattern,
	matchesPattern,
	splitSegments,
	suggestPattern,
} from "./rules.ts";

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
	const rules = loadRules(settingsPath);

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command: string =
			(event.input as { command?: string })?.command ?? "";

		// Each piped/chained sub-command is approved on its own, one prompt at a
		// time. A single segment matching the blocklist blocks the whole command.
		const segments = splitSegments(command);
		const toCheck = segments.length ? segments : [command.trim()];

		for (const seg of toCheck) {
			if (rules.blocklist.some((p) => matchesPattern(seg, p))) {
				ctx.ui.notify(`Blocked: ${seg.slice(0, 80)}`, "error");
				return { block: true, reason: `Segment matches blocklist: ${seg}` };
			}
		}

		if (!rules.requireConfirmForUnknown) return;

		const decided = new Set<string>();
		for (const seg of toCheck) {
			if (decided.has(seg)) continue; // don't re-prompt an identical segment
			if (rules.allowlist.some((p) => matchesPattern(seg, p))) continue; // pre-approved (or just allow-always'd)

			const choice = await queuedSelect(
				ctx.ui,
				`Bash approval required: ${seg.slice(0, 80)}`,
				["Allow once", "Allow always", "Deny"],
			);
			if (choice === "Allow always") {
				const edited = await ctx.ui.editor(
					"Allowlist pattern (edit before saving)",
					suggestPattern(seg),
				);
				const trimmed = edited?.trim() ?? "";
				if (!trimmed) {
					return { block: true, reason: "User cancelled allow-always" };
				}
				if (!isValidPattern(trimmed)) {
					ctx.ui.notify(
						"Pattern contains shell separators (|, &&, ;) — not saved",
						"error",
					);
					return { block: true, reason: "Invalid allowlist pattern" };
				}
				const saved = appendAllowlistPattern(settingsPath, trimmed);
				if (!saved) {
					ctx.ui.notify(
						"Could not persist pattern: settings.json is malformed — allowing for this session only",
						"warning",
					);
				}
				rules.allowlist.push(trimmed); // in-memory grant: persisted if saved, session-only if not
				decided.add(seg);
				continue;
			}
			if (choice !== "Allow once") {
				return { block: true, reason: `User denied: ${seg}` };
			}
			decided.add(seg);
		}
	});
}
