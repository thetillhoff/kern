import { readFileSync, writeFileSync } from "node:fs";

interface Settings {
	bashSafety?: { allowlist?: string[]; [k: string]: unknown };
	[k: string]: unknown;
}

// Append a glob to bashSafety.allowlist in settings.json, preserving the rest
// of the file. The allowlist is the shared, persisted grant store: every
// session (and subagent) re-reads it on each tool_call.
export function appendAllowlistPattern(
	settingsPath: string,
	pattern: string,
): void {
	let settings: Settings;
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Settings;
	} catch {
		settings = {};
	}
	if (settings.bashSafety == null) {
		settings.bashSafety = {};
	}
	const safety = settings.bashSafety;
	if (safety.allowlist == null) {
		safety.allowlist = [];
	}
	const allowlist = safety.allowlist;
	if (!allowlist.includes(pattern)) {
		allowlist.push(pattern);
		writeFileSync(
			settingsPath,
			`${JSON.stringify(settings, null, 2)}\n`,
			"utf-8",
		);
	}
}
