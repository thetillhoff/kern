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

Chained commands are approved **one sub-command at a time**. Each segment split
on `|`, `||`, `&&`, or `;` gets its own prompt:

- `echo abc | cat` - prompts for `echo abc`, then for `cat`, separately.
- A segment matching the blocklist blocks the whole command, no prompt.
- An already-allowlisted segment is skipped silently.

Segments containing command substitution (`$(` or backticks) are always prompted,
even when the outer command matches an allowlist pattern. The inner command cannot
be split out and independently checked against the blocklist.

Each prompt offers **Allow once / Allow always / Deny**. "Allow always" opens an
editable suggested glob (e.g. `echo *`) and appends it to the allowlist, so that
sub-command - and every later session and subagent - skips the prompt. A grant
added mid-command applies to the remaining segments too.

The allowlist is the shared, persisted grant store: it is re-read on every
command, so an "Allow always" grant applies process-wide and across restarts.

## Model Routing

The router selects the model for **every** session (root and subagent), in
this precedence:

1. **Explicit** - a subagent `model_tier`, or a model the human pinned
   (`pi --model X`, `/model`, or Ctrl+P). An explicit choice always wins.
2. **Ollama classifier** - classifies the prompt into `light`/`medium`/`heavy`.
3. **Light fallback** - when the classifier is disabled, unavailable, or slower
   than the gate.

Edit `~/.pi/model-rules.json`:

```json
{
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "qwen2.5-coder:7b",
  "classifierTimeoutMs": 2000,
  "defaultModel": "claude-sonnet-4-6",
  "models": {
    "light": "claude-haiku-4-5",
    "medium": "claude-sonnet-4-6",
    "heavy": "claude-opus-4-8"
  }
}
```

- `ollamaUrl: null` disables the classifier (unpinned sessions use the light
  fallback). Toggle at runtime: `/ollama enable`, `/ollama disable`, `/ollama status`.
- The classifier model is warmed on session start and as you type, so the first
  classification is not a cold load.
- `classifierTimeoutMs` gates **routing** only. A slower classification still
  finishes in the background and is logged as `reason:"ollama-late"` with its
  real latency, so you can evaluate how long it would have taken.

Decisions are traced to `~/.pi/model-decisions.jsonl` (debug). The model
actually in use is read from the live session, not this log.

## Subagents (`task` tool)

The model can delegate self-contained work to a fresh subagent:

- `prompt` - complete, standalone instructions.
- `model_tier` (optional) - `light`/`medium`/`heavy`; overrides the router for
  the child. Omit to let the child's router classify normally.
- `tools` (optional) - allowlist for the child (`ask-caller` and `task` are
  always added).
- `timeout_ms` (optional) - bound each run segment.

A subagent that cannot proceed calls the **`ask-caller`** tool; the question
returns to the calling agent, which either answers it (the tool returns
`status: "awaiting_answer"` plus a `resume` id - the caller calls `task` again
with `resume` + `answer`) or escalates with its own `ask-caller` up the chain
to the human. Permission prompts inside a subagent (e.g. `safe-bash`) forward
up to the human. Per-subagent model and token usage are logged to
`~/.pi/sessions/<childSessionId>.jsonl`.

While subagents run, the `task` result renders one live row per subagent
(nested ones indented), each showing `<id>  <model>  <tokens>  <status>` and
updating in place - `⏵ running` (with the latest action), `⏸ awaiting` (with
the pending question), `✓ done`, `✖ failed`, or `⏱ timeout`.

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
# Model routing decisions (debug trace)
tail -20 ~/.pi/model-decisions.jsonl | jq '{tier, model, reason, latencyMs}'

# Subagent activity (model, tokens, status per run segment)
cat ~/.pi/sessions/<childSessionId>.jsonl | jq '{model, tokens, status, durationMs}'

# Context compaction events
cat ~/.pi/compaction.jsonl | jq '{ts, tokensBefore, tokensLimit}'
```
