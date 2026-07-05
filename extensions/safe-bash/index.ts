import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { queuedApproval } from "../shared/permission-queue.ts";
import { appendAllowlistPattern } from "./allowlist.ts";
import {
	isPureAssignment,
	isValidPattern,
	matchesAllowlistEntry,
	matchesPattern,
	normalizePaths,
	SUBST_RE,
	splitSegments,
	suggestPattern,
} from "./rules.ts";

interface BashSafetyRules {
	blocklist: string[];
	allowlist: string[];
	requireConfirmForUnknown: boolean;
}

export function loadRules(settingsPath: string): BashSafetyRules {
	const defaults: BashSafetyRules = {
		blocklist: [],
		allowlist: [],
		requireConfirmForUnknown: true,
	};
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		// Merge per-field: a partial bashSafety (e.g. only allowlist set) must not
		// leave blocklist/requireConfirmForUnknown undefined.
		return { ...defaults, ...settings.bashSafety };
	} catch {
		return defaults;
	}
}

export default function (pi: ExtensionAPI) {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	const home = homedir();
	const cwd = process.cwd();
	const rules = loadRules(settingsPath);

	// Collects optional user comments attached to "Allow once" approvals, keyed by
	// toolCallId. The tool_result handler appends them to the bash output so the
	// agent receives the user's guidance even though the command was allowed.
	const pendingComments = new Map<string, string[]>();

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash") return;
		const comments = pendingComments.get(event.toolCallId);
		if (!comments?.length) return;
		pendingComments.delete(event.toolCallId);
		const note =
			comments.length === 1
				? `[User note: ${comments[0]}]`
				: `[User notes:\n${comments.map((c, i) => `${i + 1}. ${c}`).join("\n")}]`;
		return {
			content: [
				...event.content,
				{ type: "text" as const, text: `\n\n${note}` },
			],
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: string };
		const raw: string = input?.command ?? "";
		const command = normalizePaths(raw, home, cwd);
		if (command !== raw) input.command = command; // rewrite so Pi executes normalized form

		// Each piped/chained sub-command is approved on its own, one prompt at a
		// time. A single segment matching the blocklist blocks the whole command.
		const segments = splitSegments(command);
		if (segments === null) {
			ctx.ui.notify("Blocked: unmatched quote in command", "error");
			return {
				block: true,
				reason: "Unmatched quote — possible injection attempt",
			};
		}
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
			// Pure variable assignments (e.g. SCRIPTS=/path) execute nothing —
			// skip the approval prompt; the command that uses the variable still
			// gets its own prompt.
			if (isPureAssignment(seg)) continue;
			if (
				!SUBST_RE.test(seg) &&
				rules.allowlist.some((p) => matchesAllowlistEntry(seg, p, cwd, home))
			)
				continue; // pre-approved (or just allow-always'd)

			const { choice, note } = await queuedApproval(
				ctx.ui,
				`Bash approval required: ${seg.slice(0, 80)}`,
				["Allow once", "Allow always…", "Deny"],
				new Set(["Allow once", "Deny"]),
			);
			if (choice === "Allow always…") {
				// Show the original command in the (read-only) editor title so the
				// user can see what they are allowing while editing the pattern.
				const edited = await ctx.ui.editor(
					`Allowlist pattern for: ${seg}`,
					suggestPattern(seg),
				);
				const trimmed = edited?.trim() ?? "";
				if (!trimmed) {
					return { block: true, reason: "User cancelled allow-always" };
				}
				if (!isValidPattern(trimmed)) {
					ctx.ui.notify(
						"Pattern contains shell separators or substitution syntax — not saved",
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
			if (choice === "Allow once") {
				if (note) {
					const existing = pendingComments.get(event.toolCallId) ?? [];
					existing.push(note);
					pendingComments.set(event.toolCallId, existing);
				}
				decided.add(seg);
				continue;
			}
			// "Deny" or undefined (user cancelled the select prompt)
			let reason = `User denied: ${seg}`;
			if (choice === "Deny" && note) {
				reason = `User denied: ${seg} — ${note}`;
			}
			return { block: true, reason };
		}
	});
}
