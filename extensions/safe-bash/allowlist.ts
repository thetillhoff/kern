import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface Settings {
	bashSafety?: { allowlist?: string[]; [k: string]: unknown };
	[k: string]: unknown;
}

// Returns true if the pattern was written to disk, false if settings.json was
// malformed (we never overwrite unparseable user settings).
export function appendAllowlistPattern(
	settingsPath: string,
	pattern: string,
): boolean {
	let settings: Settings = {};
	if (existsSync(settingsPath)) {
		try {
			settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Settings;
		} catch {
			return false; // malformed: do not destroy existing user settings
		}
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
	return true;
}
