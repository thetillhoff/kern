# kern

A Pi coding agent harness with intelligent model routing, bash safety, URL fetching, context management, MCP integration, and subagent delegation.

Built on [Pi](https://github.com/earendil-works/pi). Eventually: a full terminal-native AI coding environment.

## Structure

```text
kern/
├── extensions/      # Pi extensions (TypeScript)
├── templates/       # Config templates copied to ~/.pi/ on install
└── install.sh       # Symlinks extensions, copies templates
```

## Quick Start

```bash
./install.sh
pi
```

Edit the created config files:

- `~/.pi/agent/settings.json` - default model, bash safety rules
- `~/.pi/model-rules.json` - keyword/token routing rules
- `~/.pi/PI.md` - global instructions injected every session (like `CLAUDE.md`)
- `~/.pi/mcp.json` - MCP server list for auto-discovery

## Extensions

| Extension | What it does |
| --- | --- |
| `safe-bash` | Blocks dangerous commands; prompts for unknown ones; pre-approves allowlist patterns |
| `claude-compat` | Loads `~/.pi/PI.md` and `.pi/PI.md` into the system prompt each turn |
| `model-router` | Routes to light/medium/heavy tier via keyword/token rules, then an Ollama classifier, then a default |
| `fetch-url` | Adds `fetch_url` tool for reading HTTPS URLs |
| `context-manager` | Logs context compaction events to `~/.pi/compaction.jsonl` |
| `mcp-integration` | Auto-discovers tools from MCP servers in `~/.pi/mcp.json` |
| `task` | Adds `task` tool: delegates a self-contained prompt to a fresh subagent and returns its answer |

## Development

```bash
# Extension tests
cd extensions && bun test
```
