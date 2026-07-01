import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSkillPaths } from "./skills.ts";

let tmpDirs: string[] = [];
function makeTmp(): string {
	const d = mkdtempSync(join(tmpdir(), "claude-compat-skills-"));
	tmpDirs.push(d);
	return d;
}

afterEach(() => {
	for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
	tmpDirs = [];
});

test("always includes .claude/skills from cwd", () => {
	const cwd = makeTmp();
	const paths = claudeSkillPaths(cwd, "/nonexistent");
	expect(paths).toContain(join(cwd, ".claude", "skills"));
});

test("skips installed_plugins.json when global claude dir missing", () => {
	const cwd = makeTmp();
	const paths = claudeSkillPaths(cwd, "/nonexistent");
	expect(paths).toContain(join(cwd, ".claude", "skills"));
	expect(paths).toContain(join("/nonexistent", "skills"));
	expect(paths).not.toContain(join("/nonexistent", "plugins")); // no plugin entries
});

test("reads plugin skill paths from installed_plugins.json", () => {
	const cwd = makeTmp();
	const claudeDir = makeTmp();
	const pluginsDir = join(claudeDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });

	const pluginInstallPath = join(claudeDir, "cache", "myplugin", "1.0.0");
	mkdirSync(join(pluginInstallPath, "skills"), { recursive: true });

	const installed = {
		version: 2,
		plugins: {
			"myplugin@marketplace": [{ installPath: pluginInstallPath }],
		},
	};
	writeFileSync(
		join(pluginsDir, "installed_plugins.json"),
		JSON.stringify(installed),
	);

	const paths = claudeSkillPaths(cwd, claudeDir);
	expect(paths).toContain(join(pluginInstallPath, "skills"));
});

test("includes all plugin entries", () => {
	const cwd = makeTmp();
	const claudeDir = makeTmp();
	const pluginsDir = join(claudeDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });

	const pathA = join(claudeDir, "cache", "pluginA", "1.0.0");
	const pathB = join(claudeDir, "cache", "pluginB", "2.0.0");
	mkdirSync(join(pathA, "skills"), { recursive: true });
	mkdirSync(join(pathB, "skills"), { recursive: true });

	const installed = {
		plugins: {
			"pluginA@m": [{ installPath: pathA }],
			"pluginB@m": [{ installPath: pathB }],
		},
	};
	writeFileSync(
		join(pluginsDir, "installed_plugins.json"),
		JSON.stringify(installed),
	);

	const paths = claudeSkillPaths(cwd, claudeDir);
	expect(paths).toContain(join(pathA, "skills"));
	expect(paths).toContain(join(pathB, "skills"));
});

test("skips plugin if skills/ dir does not exist", () => {
	const cwd = makeTmp();
	const claudeDir = makeTmp();
	const pluginsDir = join(claudeDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });

	const pluginInstallPath = join(claudeDir, "cache", "myplugin", "1.0.0");
	mkdirSync(pluginInstallPath, { recursive: true }); // installPath exists, but no skills/ inside

	const installed = {
		plugins: { "myplugin@m": [{ installPath: pluginInstallPath }] },
	};
	writeFileSync(
		join(pluginsDir, "installed_plugins.json"),
		JSON.stringify(installed),
	);

	const paths = claudeSkillPaths(cwd, claudeDir);
	expect(paths).not.toContain(join(pluginInstallPath, "skills"));
});

test("skips plugin skills dir if any skill name conflicts with user skills", () => {
	const cwd = makeTmp();
	const claudeDir = makeTmp();
	const pluginsDir = join(claudeDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });

	// User skill named "my-skill"
	mkdirSync(join(claudeDir, "skills", "my-skill"), { recursive: true });

	// Plugin has "my-skill" (conflict) and another skill
	const pluginPath = join(claudeDir, "cache", "myplugin", "1.0.0");
	mkdirSync(join(pluginPath, "skills", "my-skill"), { recursive: true });
	mkdirSync(join(pluginPath, "skills", "other-skill"), { recursive: true });

	const installed = {
		plugins: { "myplugin@m": [{ installPath: pluginPath }] },
	};
	writeFileSync(
		join(pluginsDir, "installed_plugins.json"),
		JSON.stringify(installed),
	);

	const paths = claudeSkillPaths(cwd, claudeDir);
	expect(paths).not.toContain(join(pluginPath, "skills"));
});

test("ignores malformed installed_plugins.json", () => {
	const cwd = makeTmp();
	const claudeDir = makeTmp();
	const pluginsDir = join(claudeDir, "plugins");
	mkdirSync(pluginsDir, { recursive: true });
	writeFileSync(join(pluginsDir, "installed_plugins.json"), "not json {{{");

	const paths = claudeSkillPaths(cwd, claudeDir);
	expect(paths).toContain(join(cwd, ".claude", "skills"));
	expect(paths).toContain(join(claudeDir, "skills"));
	// no plugin entries from malformed JSON
	expect(paths.filter((p) => p.includes("plugins"))).toHaveLength(0);
});
