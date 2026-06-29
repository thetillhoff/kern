# Extension: claude-compat

Injects `PI.md` and `CLAUDE.md` files into the system prompt at the start of
every session. Provides the same "global instructions" experience as
`~/.claude/CLAUDE.md` in Claude Code.

## Files loaded (in order)

1. `~/.pi/PI.md` — global Pi instructions
2. `.pi/PI.md` in the current working directory — project-level overrides
3. `.claude/CLAUDE.md` in the current working directory — project CLAUDE.md

`~/.claude/CLAUDE.md` is intentionally **not** loaded when no explicit directory
is given, to prevent Claude Code harness config (tool permissions, editor
settings) from leaking into the Pi agent.

All found files are concatenated with `\n\n---\n\n` separators and appended to
the existing system prompt in `before_agent_start`.

## Skills discovered

Via `resources_discover`, the extension contributes extra skill directories so
Pi can load Claude Code skills alongside its own `.pi/skills/`:

1. `.claude/skills/` in the current working directory — project-level skills
2. `~/.claude/skills/` — global user skills (fuck-slop, grill, junior-to-senior, etc.)
3. `<installPath>/skills/` for every entry in
   `~/.claude/plugins/installed_plugins.json` — globally installed plugin skills

Missing directories are silently skipped by Pi's skill loader.

## Files

| File | Role |
| --- | --- |
| `index.ts` | Wires `before_agent_start` and `resources_discover` hooks |
| `loader.ts` | `loadPIMd(cwd, globalPiDir?, globalClaudeDir?)` — file discovery + concatenation |
| `skills.ts` | `claudeSkillPaths(cwd, globalClaudeDir?)` — returns skill dirs from `.claude/` |
