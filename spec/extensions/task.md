# Extension: task

Adds a `task` tool that delegates self-contained work to a fresh Pi subagent. The
subagent runs in its own context window. It can ask its caller questions via
`ask-caller`, forward permission prompts to the human, and be bounded by a
timeout. Multiple tasks can be issued in one model turn to run in parallel.

## Tool parameters

```ts
{
  prompt?: string;        // complete, standalone instructions (new subagent)
  model_tier?: "light" | "medium" | "heavy";  // override model for the child
  tools?: string[];       // allowlist; ask-caller and task are always added
  timeout_ms?: number;    // abort a run segment after this many ms
  resume?: string;        // childSessionId from a prior awaiting_answer result
  answer?: string;        // the answer to feed the resumed subagent
}
```

Provide `prompt` to spawn. Provide `resume` + `answer` to continue a paused
subagent. Both paths are mutually exclusive.

## Spawn flow

1. Build a `DefaultResourceLoader` with the parent's `cwd`, `agentDir`
   (`~/.pi/agent`), and the parent's system prompt (so the child inherits it).
   Append two lines that tell the child it is a subagent and to use `ask-caller`.
2. Resolve the model from `model_tier` via `model-rules.json` and pass it
   directly to `createAgentSession` (not via the override store, because child
   sessions have no model-router extension installed).
3. Call `createAgentSession` with the loader, optional model, custom tool
   `ask-caller`, and the augmented tools list.
4. Forward the parent UI to the child session:
   `session.extensionRunner.setUIContext(ctx.ui, ctx.mode)`.
   This routes child permission prompts (e.g. safe-bash) to the human.
5. Register the child in the shared `registry` map under its `sessionId`.
6. Call `session.prompt(params.prompt)` to start the run (non-blocking).
7. Race the run promise against: the question signal, the timeout timer.

## `ask-caller` tool

Registered as a custom tool on every child session. When called:

1. Look up the child's `ChildEntry` in the registry.
2. Resolve the pending `questionSignal` promise with the question text.
3. Return a new promise that resolves only when `entry.resolveAsk` is called
   (i.e. when the parent delivers the answer via a `task` resume call).

The parent receives `status: "awaiting_answer"` and a `resume` id in the tool
result.

## Resume flow

When the parent calls `task` with `resume` + `answer`:

1. Look up the entry. If not found, return an error.
2. Log the answer event.
3. Call `entry.resolveAsk(answer)` to unblock `ask-caller` in the child.
4. Reset `questionSignal` to a fresh deferred.
5. Re-enter `runSegment` to race the next segment.

## Run segment outcomes

`runSegment` races the child run promise against the question signal and an
optional timeout:

| Outcome | Return `status` | Side effect |
| --- | --- | --- |
| `completed` | `"completed"` | Extract last assistant text; dispose session; remove from registry |
| asked a question | `"awaiting_answer"` | Keep session alive; log `"asked"` |
| timed out | `"timeout"` | Abort + dispose session; remove from registry |
| run promise rejected | `"aborted"` | Dispose session; remove from registry |

## Live status widget

A `belowEditor` widget shows one row per subagent (nested children indented by
depth). Each row:

```text
<8-char-id>  <model>  <tokens>  <status-glyph>  [note]
```

Status glyphs: `⏵ running`, `⏸ awaiting`, `✓ done`, `✖ failed`, `⏱ timeout`.
`note` is the current tool name while running, or the pending question while
awaiting.

The widget is set up in `session_start` for the root session only. Every
`subscribe` event on any session calls `notify()`, which triggers all open redraw
callbacks and the widget callback.

## Session logging

Every lifecycle transition (spawned, running, asked, answered, completed, aborted,
timeout) is appended to `~/.pi/sessions/<childSessionId>.jsonl`:

```jsonc
{
  "ts": "<ISO>",
  "parentSession": "...",
  "childSession": "...",
  "model": "claude-haiku-4-5",
  "tokens": 12340,
  "status": "completed",
  "durationMs": 4200
}
```

## Registry (`registry.ts`)

Module-level `Map<string, ChildEntry>`. Shared across the parent and all child
sessions because `createAgentSession` runs in the same Node process.

`ChildEntry`:

- `session: AgentSession`
- `model: string` — updated live from `session.model?.id`
- `runPromise?: Promise<void>`
- `resolveAsk?: (answer: string) => void`
- `questionSignal: Deferred<{ question: string }>`
- `tokensTotal: number`
- `status: RowStatus`
- `startedAt: number`
- `parentId?: string` — for nesting
- `note?: string` — latest action or pending question

## Shutdown cleanup

`session_shutdown` sweeps all descendants of the shutting-down session (found via
`descendantsOf`), aborts and disposes each one. For the root session, also clears
the widget and callback.

## Files

| File | Role |
| --- | --- |
| `index.ts` | Tool registration, spawn/resume logic, widget setup, shutdown cleanup |
| `registry.ts` | `ChildEntry`, `registry` map, row rendering, `deferred`, `augmentTools` |
| `logger.ts` | `appendSubagentLog` — writes to per-child JSONL |
