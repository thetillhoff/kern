# kern

A Pi coding agent harness with intelligent model routing, bash safety, URL fetching, context management, and MCP integration.

Built on [Pi](https://github.com/earendil-works/pi). Eventually: a full terminal-native AI coding environment.

## Structure

```text
kern/
├── extensions/      # Pi extensions (TypeScript)
├── router/          # OpenAI-compatible routing proxy (Python)
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
| `model-router` | Routes to local/medium/heavy tier via rules then Python router then default |
| `fetch-url` | Adds `fetch_url` tool for reading HTTPS URLs |
| `context-manager` | Logs context compaction events to `~/.pi/compaction.jsonl` |
| `mcp-integration` | Auto-discovers tools from MCP servers in `~/.pi/mcp.json` |

## Router (optional)

The Python router is an OpenAI-compatible HTTP proxy that classifies requests and forwards to the right model tier. The `model-router` extension calls it as a tier-2 classifier.

```bash
cd router
docker build -t kern-router .
cp config.yaml config.local.yaml  # edit with your models
docker run --rm -p 8080:8080 -v "$PWD/config.local.yaml:/app/config.yaml" kern-router
```

## Development

```bash
# Extension tests
cd extensions && bun test

# Router tests (Docker)
cd router && docker run --rm -v "$PWD:/app" -w /app kern-router pytest -v
```
