# Changelog

## v0.1.9

- Fix Bedrock crash after prompt authentication: statically import `bedrock-provider` so bun bundles it (was missing from compiled binary, causing `Cannot find module './amazon-bedrock.js'`)

## v0.1.8

- Suppress skill conflict warnings: skip plugin skills dirs whose skill names are already claimed by user or project skills

## v0.1.7

- Suppress "skill path does not exist" warnings for Claude Code plugins that don't ship a `skills/` directory

## v0.1.6

- Fix `kern v0.0.0` in UI: pass `VERSION` env to Package step so `package.json` in tarball gets the correct version
- Suppress pi.dev update nag in Homebrew install (`PI_SKIP_VERSION_CHECK=1` in wrapper script)

## v0.1.5

- Fix extension conflict errors when pi is installed in parallel: kern now always uses `~/.kern/agent` (no fallback to `~/.pi/agent`). Set `KERN_CODING_AGENT_DIR` to override.

## v0.1.4

- `bun run build` compiles to `dist/` with all runtime assets staged
- `bun run verify` smoke-tests the local binary before tagging
- Add `*.bun-build` and `dist/` to `.gitignore`

## v0.1.3

- UI shows `kern` instead of `π / pi` (via `piConfig.name` in package.json)
- Config dir defaults to `~/.kern/agent`; falls back to `~/.pi/agent` if it exists (migration path), or `~/.claude/kern` if it exists

## v0.1.2

- Add `-v` as alias for `--version`
- Bundle `package.json` with correct version in release tarballs so pi's version fallback path also reports the correct version

## v0.1.1

Fix runtime crash on startup: bundle `theme/`, `assets/`, and `export-html/` directories alongside the binary in release tarballs, and install via a wrapper script that sets `PI_PACKAGE_DIR`.

## v0.1.0

Initial release. Includes the following extensions:

- `safe-bash` — blocklist/allowlist bash safety; per-segment approval with Allow once / Allow always / Deny; command substitution (`$(`, backticks, `<(`, `>(`) always prompts regardless of allowlist
- `claude-compat` — injects `~/.pi/PI.md` and project `.pi/PI.md` / `.claude/CLAUDE.md` into the system prompt; exposes Claude Code skill directories to Pi
- `model-router` — explicit → Ollama classifier → light fallback precedence; human-pin detection; `/ollama` command; decisions traced to `~/.pi/model-decisions.jsonl`
- `fetch-url` — HTTPS-only `fetch_url` tool with SSRF protection (blocklist + DNS pre-resolution), redirect re-validation, 2 MB body limit
- `context-manager` — logs compaction events to `~/.pi/compaction.jsonl`
- `mcp-integration` — auto-discovers tools from MCP servers in `~/.pi/mcp.json`
- `task` — subagent delegation with `ask-caller` question escalation, permission forwarding to the human, `timeout_ms` per run segment, token accounting, live status widget
