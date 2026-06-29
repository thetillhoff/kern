# kern

A Pi coding agent harness with intelligent model routing, bash safety, URL fetching, context management, MCP integration, and subagent delegation.

Built on [Pi](https://github.com/earendil-works/pi). Eventually: a full terminal-native AI coding environment.

## Structure

```text
kern/
├── kern.ts          # Entry point - bundles all extensions into one binary
├── extensions/      # Pi extensions (TypeScript)
└── templates/       # Config templates copied to ~/.pi/ on install
```

## Quick Start

Build the binary:

```bash
bun install
bun run build        # produces ./kern
```

Run it:

```bash
./kern
```

Edit the config files:

- `~/.pi/agent/settings.json` - default model, bash safety rules
- `~/.pi/model-rules.json` - tier→model map, Ollama classifier settings, default/fallback model
- `~/.pi/PI.md` - global instructions injected every session (like `CLAUDE.md`)
- `~/.pi/mcp.json` - MCP server list for auto-discovery

## Extensions

| Extension | What it does |
| --- | --- |
| `safe-bash` | Blocks dangerous commands; pre-approves allowlist patterns; prompts for unknown ones one sub-command at a time (split on `\|`, `\|\|`, `&&`, `;`) with Allow once / Allow always (edited pattern persisted to the shared allowlist) / Deny |
| `claude-compat` | Loads `~/.pi/PI.md` and `.pi/PI.md` into the system prompt each turn |
| `model-router` | Selects the model for every session: an explicit tier (subagent `model_tier`) or human-pinned model wins, else an Ollama classifier picks light/medium/heavy, else a light fallback. Classifier is warmed on session start and on typing; decisions (incl. would-have-been latencies) traced to `~/.pi/model-decisions.jsonl` |
| `fetch-url` | Adds `fetch_url` tool for reading HTTPS URLs |
| `context-manager` | Logs context compaction events to `~/.pi/compaction.jsonl` |
| `mcp-integration` | Auto-discovers tools from MCP servers in `~/.pi/mcp.json` |
| `task` | Subagent delegation: a subagent uses `ask-caller` to escalate questions to its caller, permission prompts route to the human, `timeout_ms` bounds each run segment, the parent's system prompt is inherited, and token usage is logged to `~/.pi/sessions/<childSessionId>.jsonl` |

See [EXAMPLES.md](EXAMPLES.md) for per-extension usage and config.

## Development

```bash
cd extensions
bun test                      # extension tests
npx tsc --noEmit              # typecheck extensions
npx @biomejs/biome check .    # lint + format
```

Typecheck the entry point from the repo root:

```bash
node_modules/.bin/tsc --noEmit -p tsconfig.json
```

See [spec/overview.md](spec/overview.md) for how to find the Pi API, verify
changes, and the traps this codebase already hit.
