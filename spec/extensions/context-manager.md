# Extension: context-manager

Logs context compaction events and notifies the user when the context window is
being compacted.

## Behaviour

On `session_before_compact`:

1. Read current context usage via `ctx.getContextUsage()` (`total`, `limit`).
2. Compute fill percentage: `Math.round((total / limit) * 100)`.
3. Emit an info notification: `Compacting context (N% full, T tokens)`.
4. Append an entry to `~/.pi/compaction.jsonl`.

## Log format

```jsonc
{
  "ts": "<ISO timestamp>",
  "session": "<sessionId>",
  "tokensBefore": 98000,
  "tokensLimit": 100000,
  "trigger": "auto"
}
```

## Files

| File | Role |
| --- | --- |
| `index.ts` | Wires `session_before_compact` hook |
| `logger.ts` | `appendCompactionLog` — writes to the JSONL log |
