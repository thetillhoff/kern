# Changelog

## v0.1.0

Initial release. Includes the following extensions:

- `safe-bash` — blocklist/allowlist bash safety; per-segment approval with Allow once / Allow always / Deny; command substitution (`$(`, backticks, `<(`, `>(`) always prompts regardless of allowlist
- `claude-compat` — injects `~/.pi/PI.md` and project `.pi/PI.md` / `.claude/CLAUDE.md` into the system prompt; exposes Claude Code skill directories to Pi
- `model-router` — explicit → Ollama classifier → light fallback precedence; human-pin detection; `/ollama` command; decisions traced to `~/.pi/model-decisions.jsonl`
- `fetch-url` — HTTPS-only `fetch_url` tool with SSRF protection (blocklist + DNS pre-resolution), redirect re-validation, 2 MB body limit
- `context-manager` — logs compaction events to `~/.pi/compaction.jsonl`
- `mcp-integration` — auto-discovers tools from MCP servers in `~/.pi/mcp.json`
- `task` — subagent delegation with `ask-caller` question escalation, permission forwarding to the human, `timeout_ms` per run segment, token accounting, live status widget
