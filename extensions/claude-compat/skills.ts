import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface PluginEntry {
	installPath: string;
}

interface InstalledPlugins {
	plugins?: Record<string, PluginEntry[]>;
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
	paths.push(join(claudeDir, "skills"));

	// Global: each installed plugin's skills/ dir
	const pluginsJson = join(claudeDir, "plugins", "installed_plugins.json");
	if (existsSync(pluginsJson)) {
		try {
			const data: InstalledPlugins = JSON.parse(
				readFileSync(pluginsJson, "utf-8"),
			);
			for (const entries of Object.values(data.plugins ?? {})) {
				for (const entry of entries) {
					const skillsDir = join(entry.installPath, "skills");
					if (existsSync(skillsDir)) {
						paths.push(skillsDir);
					}
				}
			}
		} catch {
			// ignore malformed installed_plugins.json
		}
	}

	return paths;
}
