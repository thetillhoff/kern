# Pi Harness Research Report

## Tool Comparison Matrix

| Dimension | Claude Code | Codex CLI | Aider | OpenCode | Pi (base) |
| --- | --- | --- | --- | --- | --- |
| **Language** | TypeScript | TypeScript | Python | TypeScript/Bun | TypeScript |
| **Bash safety** | Allowlist/blocklist patterns in `settings.json`; per-tool param matching | Sandbox modes: `workspace-write` (no git push/network), `full-access` | No approval layer; `shell=True` subprocess | Permission state machine: ask/allow/deny per pattern; subagent inherits parent denies | `tool_call` event hook; no built-in sandbox |
| **Bash approval** | Prompt per unrecognized command; `Bash(pattern)` to pre-approve | Mode-level; no per-command approval | None | 3-stage: prompt → confirm → execute | `ctx.ui.confirm()` in extension |
| **CLAUDE.md / instructions** | `~/.claude/CLAUDE.md` + `.claude/CLAUDE.md`; closest dir wins; plain markdown | None built-in | None | None | `skills` system in Pi; closest `.pi/skills/` wins |
| **Skills** | YAML frontmatter + markdown; progressive disclosure; auto-triggered by description | None | None | None | Built-in: `~/.pi/agent/skills/`; YAML+markdown same pattern |
| **MCP integration** | Auto-discover from `settings.json`; `mcp__server__tool` naming; deferred schema load | None | None | None | None built-in; registerable via extension `registerProvider` |
| **Subagents** | `Agent` tool; 5-level nesting; parallel; context-isolated | None | None | Task spawning with permission inheritance | No native; doable via extension + `registerTool` |
| **Model routing** | Single model; override via flags | Single model | Config `weak_model` fallback | Provider-based; Effect retry layers | Multi-provider; `pi.setModel()`; `registerProvider()` |
| **Context compaction** | Auto at ~85-95% fill; history summarization | Not documented | RepoMap token estimation; dynamic scaling | Token metrics tracked; no auto-compaction | `session_before_compact` event; configurable `reserveTokens` / `keepRecentTokens` |
| **Decision logging** | `~/.claude/security/log.txt` append-only; per-session state JSON | None | None | None | None built-in |
| **Hooks/events** | `hooks.json`; SessionStart/PromptSubmit/PostToolUse/Stop | None | None | None | Rich event system: 20+ events incl. `tool_call`, `before_agent_start`, `session_before_compact` |
| **Extension system** | Skills + hooks (no code extensions) | None | None | Zod-based plugin tools | Full TypeScript extensions; `registerTool`, `registerCommand`, event intercept |
| **Config files** | `settings.json`, `CLAUDE.md`, `hooks.json` | `config.toml` | `.aider.conf.yml` | `config.json` | `settings.json`, `models.json`, `auth.json` |

---

## Key Patterns Worth Copying

### 1. Bash safety - Pi `tool_call` event is the right hook

Pi's `tool_call` event fires before execution and can return `{ block: true, reason }` or mutate
`event.input.command`. No separate sandbox needed - a single extension handles:

- Blocklist matching (regex against command)
- Allowlist short-circuit (skip confirm if pattern matches)
- `ctx.ui.confirm()` fallback for unrecognized commands

**Threshold worth copying from Claude Code:** Pattern syntax `Bash(git add *)` - tool name +
glob on command - stored in `settings.json`. Simple to parse, easy for users to add rules.

### 2. Model routing - rules first, classifier second

Claude Code uses a single model. The existing Python router in this repo fills the gap but is
a separate process. The better architecture: embed routing *inside Pi* as an extension, not a
proxy. The extension intercepts `before_agent_start`, decides the model, calls `pi.setModel()`.

Three-tier decision ladder (lowest latency first):

1. **Rule-based** - keyword/context-size/file-count rules from `model-rules.json` (~0ms)
2. **Local classifier** - small Ollama model for ambiguous cases (~300-800ms)
3. **Default** - falls back to configured default if classifier times out

### 3. CLAUDE.md compat - Pi already has skills; PI.md is the right analog

Pi loads skills from `~/.pi/agent/skills/` and `.pi/skills/`. The equivalent of `CLAUDE.md` is
a "system-prompt skill" loaded unconditionally at session start. Implement as a `session_start`
handler that reads `~/.pi/PI.md` and `.pi/PI.md`, injects both into the system prompt via
`before_agent_start`.

### 4. Context compaction - Pi's event covers it

`session_before_compact` fires before Pi auto-compacts. The extension can provide a custom
summary strategy. The 70%/90% thresholds from the spec should be soft-warn / hard-compact, but
Pi's `keepRecentTokens` + `reserveTokens` config already drives when compaction fires. The
extension just needs to hook the event and optionally log it.

### 5. Decision logging - structured JSON, not plaintext

Claude Code uses append-only plaintext. Better for querying: JSONL file where each line is:

```json
{"ts":"...","session":"...","model":"...","tier":"...","reason":"...","rule":"...","latency_ms":0}
```

### 6. MCP integration - Pi `registerProvider` is sufficient

Pi can register custom providers. An MCP extension auto-discovers running MCP servers (from
`~/.pi/mcp.json`), fetches their tool schemas at session start via `resources_discover` event,
and registers each tool. No need to invent a new protocol.

---

## What Needs Building (and What Doesn't)

### Already in Pi (no code needed)

| Feature | How Pi covers it |
| --- | --- |
| Context compaction | `compaction` config in `settings.json` + `session_before_compact` event |
| Multi-provider model switching | `registerProvider()` + `pi.setModel()` |
| Custom commands | `registerCommand()` |
| UI approval dialogs | `ctx.ui.confirm()` |
| Session persistence | Built-in session system |
| Skills loading | `~/.pi/agent/skills/` auto-discovered |

### Needs an extension

| Extension | What it does | Complexity |
| --- | --- | --- |
| `safe-bash` | Blocklist/allowlist via `tool_call` event; `settings.json` rules | Low |
| `model-router` | Intercepts `before_agent_start`; rule→classifier→default ladder; logs to JSONL | Medium |
| `claude-compat` | Loads `~/.pi/PI.md` + `.pi/PI.md` into system prompt | Low |
| `fetch-url` | Registers `fetch_url` tool; HTTPS only; returns text/parsed content | Low |
| `mcp-integration` | Reads `~/.pi/mcp.json`; registers discovered tools at `resources_discover` | Medium |
| `context-manager` | Hooks `session_before_compact`; logs compaction events; custom summary | Low |
| `subagent` | Registers `/subagent` command + `spawn_subagent` tool; runs nested pi sessions | High |

### Needs config files (no code, just JSON/YAML)

- `~/.pi/agent/settings.json` - default model, compaction thresholds
- `~/.pi/model-rules.json` - rule-based routing table
- `~/.pi/PI.md` - global system prompt (CLAUDE.md equivalent)

---

## What NOT to Build

- **New proxy server** - the existing Python router covers that use case. Pi extensions route
  internally; no separate process needed.
- **fetch_url with BeautifulSoup** - Pi is TypeScript. Use `node-html-parser` or just return
  raw text with a note to the LLM. BeautifulSoup is Python-only.
- **`phi3:3.8b` as router model** - `phi3` is old. `qwen3:1.7b` or `llama3.2:1b` are faster
  and more capable for classification. Make it configurable.
- **Separate decision log server** - JSONL append to `~/.pi/model-decisions.jsonl` is enough.
- **Subagents (v1)** - subagent support in Pi requires spawning child Pi processes, managing
  I/O, and merging results. High complexity, low ROI for v1. Stub the command, defer real impl.

---

## Proposed Build Scope (v1)

Six extensions + three config files. Ordered by value/complexity ratio:

1. `safe-bash` - highest safety value, lowest complexity
2. `claude-compat` - enables `PI.md` workflow immediately
3. `model-router` - core routing value; uses existing Python router as classifier backend
4. `fetch-url` - useful standalone tool
5. `context-manager` - low complexity, good observability
6. `mcp-integration` - medium complexity; enables MCP ecosystem

Excluded from v1: subagents (stub only).

---

## Relationship to Existing Python Router

The Python router (`src/ai_router/`) stays. The Pi `model-router` extension calls it as a
backend for the "classifier" tier of the routing ladder:

```text
Pi extension (rule-based fast path)
  → Python router at localhost:8080 (classifier + backend selection)
    → Ollama / Anthropic backends
```

This means the Python router's classifier (Qwen3 4B via Ollama) becomes step 2 in Pi's
three-tier ladder. Pi extensions add the rule-based fast path on top and the logging layer.
