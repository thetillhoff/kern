# ai-router

Two complementary tools for intelligent AI model routing:

1. **Python Router** (`src/ai_router/`) - OpenAI-compatible HTTP proxy that classifies requests and forwards to the right model tier (local Ollama / cloud Anthropic).
2. **Pi Extensions** (`pi-extensions/`) - TypeScript extensions for the [Pi coding agent](https://github.com/earendil-works/pi) that add bash safety, model routing, URL fetching, context logging, and MCP integration.

## How They Fit Together

```text
Pi (coding agent)
  model-router extension
    rule-based fast path (~0ms)
    → Python router at :8080 (Ollama classifier, ~300-800ms)
        → local tier: Ollama qwen3:4b
        → medium tier: claude-sonnet
        → heavy tier: claude-opus
```

## Quick Start

### Python Router

```bash
pip install -e ".[dev]"
cp config.yaml config.local.yaml  # edit with your models
ai-router
```

Router runs at `http://localhost:8080`. See `config.yaml` for tier/model configuration.

### Pi Extensions

Requirements: [Pi](https://github.com/earendil-works/pi) installed, [Bun](https://bun.sh) for tests.

```bash
./install.sh   # symlinks extensions, copies config templates to ~/.pi/
```

Edit the created config files:

- `~/.pi/agent/settings.json` - default model, compaction, bash safety rules
- `~/.pi/model-rules.json` - keyword/token routing rules
- `~/.pi/PI.md` - global instructions injected into every session (like `CLAUDE.md`)
- `~/.pi/mcp.json` - MCP server list for auto-discovery

Start Pi and the extensions load automatically:

```bash
pi
```

### Running Extension Tests

```bash
cd pi-extensions && bun test
```

## Extensions

| Extension | What it does |
| --- | --- |
| `safe-bash` | Blocks dangerous commands; prompts for unknown ones; pre-approves allowlist patterns |
| `claude-compat` | Loads `~/.pi/PI.md` and `.pi/PI.md` into the system prompt each turn |
| `model-router` | Routes to local/medium/heavy tier via rules then Python router then default |
| `fetch-url` | Adds `fetch_url` tool for reading HTTPS URLs |
| `context-manager` | Logs context compaction events to `~/.pi/compaction.jsonl` |
| `mcp-integration` | Auto-discovers tools from MCP servers in `~/.pi/mcp.json` |

## Development

```bash
# Python router tests
pip install -e ".[dev]"
pytest -v

# Extension tests
cd pi-extensions && bun test
```
