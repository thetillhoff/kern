import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface PluginEntry {
	installPath: string;
}

interface InstalledPlugins {
	plugins?: Record<string, PluginEntry[]>;
}

function skillNamesInDir(dir: string): Set<string> {
	try {
		return new Set(readdirSync(dir));
	} catch {
		return new Set();
	}
}

export function claudeSkillPaths(
	cwd: string,
	globalClaudeDir?: string,
): string[] {
	const paths: string[] = [];
	const claudeDir = globalClaudeDir ?? join(homedir(), ".claude");

	// Project-local: .claude/skills/ in cwd
	paths.push(join(cwd, ".claude", "skills"));

	// Global user skills: ~/.claude/skills/
	const userSkillsDir = join(claudeDir, "skills");
	paths.push(userSkillsDir);

	// Collect names already claimed so plugin dirs don't shadow them
	const claimedNames = new Set([
		...skillNamesInDir(join(cwd, ".claude", "skills")),
		...skillNamesInDir(userSkillsDir),
	]);

	// Global: each installed plugin's skills/ dir (skip if any skill would conflict)
	const pluginsJson = join(claudeDir, "plugins", "installed_plugins.json");
	if (existsSync(pluginsJson)) {
		try {
			const data: InstalledPlugins = JSON.parse(
				readFileSync(pluginsJson, "utf-8"),
			);
			for (const entries of Object.values(data.plugins ?? {})) {
				for (const entry of entries) {
					const skillsDir = join(entry.installPath, "skills");
					if (!existsSync(skillsDir)) continue;
					const pluginNames = skillNamesInDir(skillsDir);
					const hasConflict = [...pluginNames].some((n) => claimedNames.has(n));
					if (!hasConflict) {
						paths.push(skillsDir);
						for (const n of pluginNames) claimedNames.add(n);
					}
				}
			}
		} catch {
			// ignore malformed installed_plugins.json
		}
	}

	return paths;
}
