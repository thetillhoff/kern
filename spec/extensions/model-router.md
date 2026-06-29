# Extension: model-router

Selects the model for every Pi session (root and subagent children) according to
a fixed precedence. Decisions are traced to `~/.pi/model-decisions.jsonl`.

## Config (`~/.pi/model-rules.json`)

```json
{
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "qwen3:4b",
  "classifierTimeoutMs": 2000,
  "defaultModel": "claude-sonnet-4-6",
  "models": {
    "light": "claude-haiku-4-5",
    "medium": "claude-sonnet-4-6",
    "heavy": "claude-opus-4-8"
  }
}
```

`ollamaUrl: null` disables the classifier; unpinned sessions fall back to the
`light` model (or `defaultModel` if `light` is not mapped).

## Routing precedence

1. **Human-pinned** — the human set the model explicitly (`pi --model X`, `/model`,
   or Ctrl+P). Router skips; logs `reason: "explicit"`.
2. **Ollama classifier** — if `ollamaUrl` and `ollamaModel` are set, call
   `POST <ollamaUrl>/api/generate` with the session's first prompt. Classify the
   text into `light`, `medium`, or `heavy`. Gated by `classifierTimeoutMs`:
   - Result arrives within the gate → route to the classified tier.
   - Gate exceeded → fall back immediately; let the classifier call finish in the
     background; log `reason: "ollama-late"` with actual latency when it completes.
3. **Fallback** — route to the `light` model (or `defaultModel`). Logged as
   `reason: "fallback"`.

## Human-pin detection

A launch flag (`pi --model X`) does not emit a `model_select` event. Detect it in
`before_agent_start`: if the live session model differs from `settings.json`'s
`defaultModel` and the router did not set it, treat the session as pinned.

The `model_select` event covers `/model` and Ctrl+P; `source === "set"` or
`source === "cycle"` → pin the session.

## Cross-session state (`override.ts`)

Stored in `globalThis.__kernModelRouterOverride` (a plain object with three Maps/Sets)
so state survives across module-graph duplications:

- `tierOverrides: Map<sessionId, tier>` — tier set by a `task()` call for a child
  session; consumed once by `before_agent_start`.
- `pinnedSessions: Set<sessionId>` — sessions the human pinned.
- `routerSet: Map<sessionId, modelId>` — last model the router itself set, so the
  `model_select` handler can distinguish router-driven changes from human ones.

All entries for a session are cleared in `session_shutdown`.

## Classifier warmup

Ollama cold-starts in ~14 s. The extension warms the model on `session_start` and
again on each terminal input event, throttled to once per 60 s. Warmup is a
fire-and-forget `POST /api/generate` with an empty prompt.

## `/ollama` command

Registered as a Pi slash command with subcommands:
`status`, `enable [url]`, `disable`, `url <url>`, `model <name>`.

Each subcommand reads, mutates, and writes `model-rules.json` immediately.

## Decision log

Every routing decision appended to `~/.pi/model-decisions.jsonl`:

```jsonc
{
  "ts": "<ISO timestamp>",
  "session": "<sessionId>",
  "tier": "medium",
  "model": "claude-sonnet-4-6",
  "reason": "ollama",          // "explicit" | "ollama" | "ollama-late" | "fallback"
  "latencyMs": 340
}
```

## Files

| File | Role |
| --- | --- |
| `index.ts` | `ExtensionAPI` wiring; precedence logic, `/ollama` command |
| `classifier.ts` | `callOllama`, `warmupOllama` |
| `decision.ts` | `currentModelId` helper |
| `logger.ts` | `appendDecision` — writes to the JSONL log |
| `override.ts` | `globalThis`-backed cross-session state store |
