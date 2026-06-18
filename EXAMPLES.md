# Pi Extensions - Example Workflows

## Bash Safety

Add patterns to `~/.pi/agent/settings.json`:

```json
{
  "bashSafety": {
    "blocklist": ["rm -rf /", "rm -rf ~"],
    "allowlist": ["git *", "bun *", "npm *"],
    "requireConfirmForUnknown": true
  }
}
```

Behavior:

- `git add -A` - auto-approved (matches `git *`)
- `rm -rf /` - blocked immediately, no prompt
- `curl ... | bash` - confirmation dialog appears

## Model Routing

Edit `~/.pi/model-rules.json` to tune routing:

```json
{
  "rules": [
    { "if": { "tokenCount": { "lt": 300 } }, "then": "local" },
    { "if": { "keywords": ["ls", "grep", "cat"] }, "then": "local" },
    { "if": { "keywords": ["architect", "design", "review all"] }, "then": "heavy" }
  ],
  "classifierUrl": "http://localhost:8080",
  "classifierTimeoutMs": 2000,
  "defaultModel": "claude-sonnet-4-20250514",
  "models": {
    "local": "qwen3:4b",
    "medium": "claude-sonnet-4-20250514",
    "heavy": "claude-opus-4-8-20251101"
  }
}
```

Check routing decisions:

```bash
tail -f ~/.pi/model-decisions.jsonl | jq .
```

## PI.md - Global Instructions

`~/.pi/PI.md` is injected into every Pi session. Use it for project-agnostic rules:

```markdown
## Git

- Always use SSH URLs for git clone
- Use `cd <path> && git <cmd>`, never `git -C`

## Code

- No unnecessary comments
- Prefer editing existing files over creating new ones
```

Per-project overrides go in `.pi/PI.md` at the project root. Both files are loaded;
project-level content appears after global content.

## URL Fetching

The `fetch_url` tool is available once the extension loads:

```text
User: fetch https://docs.anthropic.com/en/api/getting-started and summarize the auth section
```

Pi calls `fetch_url`, strips HTML, summarizes plain text.

## MCP Servers

Add servers to `~/.pi/mcp.json`:

```json
{
  "servers": [
    { "name": "filesystem", "url": "http://localhost:3000" },
    { "name": "browser", "url": "http://localhost:3001" }
  ]
}
```

On session start, Pi auto-registers all tools from each server.
Registered as `mcp__<server>__<tool>` - e.g. `mcp__filesystem__read_file`.

## Checking Logs

```bash
# Model routing decisions
tail -20 ~/.pi/model-decisions.jsonl | jq '{tier, model, reason, latencyMs}'

# Context compaction events
cat ~/.pi/compaction.jsonl | jq '{ts, tokensBefore, tokensLimit}'
```
