# TODO

## Next Up

Nothing queued. See Backlog.

---

## Done This Session

- **`task` subagent escalation** - Rewrote the extension into a continuation engine.
  `task.execute` no longer awaits the child to completion; it races the child's `prompt()`
  against a question signal and an optional `timeout_ms`. A subagent calls the new `ask-caller`
  tool (injected child-only via `customTools`) to ask its caller; `task` returns
  `awaiting_answer` + the child id to the parent LLM, which answers via a `resume` + `answer`
  call or escalates with its own `ask-caller`. State lives in a process-shared registry keyed
  by child `sessionId`. A child `prompt()` rejection/abort or a timeout disposes + deletes the
  entry exactly once (no leak). Verified live against Bedrock - see `extensions/task/SMOKE.md`.
- **`task` permission forwarding** - Child UI context is set to the parent's `ctx.ui` via
  `setUIContext`, so a subagent's `ui.confirm`/`input`/`select` (e.g. `safe-bash`) forwards up
  the chain to the human at the root.
- **`task` context inheritance + token accounting** - Child built with a `DefaultResourceLoader`
  carrying the parent's `getSystemPrompt()` plus a subagent note; skills load from disk. Per
  segment reads `getSessionStats().tokens`, shows a one-line `setStatus`, and logs to
  `~/.pi/subagent.jsonl`.
- **`safe-bash` Allow-always grant** - Replaced the boolean confirm with Allow once / Allow
  always / Deny. "Allow always" opens an editable suggested glob and appends it to the shared
  `bashSafety.allowlist` (re-read every `tool_call`, so shared across subagents and persisted);
  a malformed `settings.json` is never overwritten.
- **`model-router` logging fixes** - Default branch logs the real session model (not always
  `defaultModel`); a configured-but-failed Ollama classifier logs `ollama-failed` instead of a
  silent `default`.

---

## Backlog

Things worth doing but not blocking immediate use.

### Pi extensions

- **`task`: depth limit** - Deferred this round. Subagents can spawn subagents with no cap;
  add a depth budget (injected into the child and decremented per level) to bound recursion.
- **`task`: full inline child streaming** - A one-line live status (`setStatus`) shipped;
  surfacing the subagent's full message stream inline in the parent UI is still open.
- **`task`: orphaned-entry cleanup** - A parent-abort while a child is suspended in
  `awaiting_answer` (between segments, after `execute` returned) leaks its registry entry. Add
  a session-scoped sweep or a `session_shutdown` cleanup.
- **`task`: clear status footer on timeout** - The timeout branch leaves the last token-count
  `setStatus` line; clear it like the completed/aborted branches do.
- **`safe-bash`: blocklist wildcards at the start** - Current pattern matching requires the
  wildcard to be at the end (`rm -rf *`). Add support for `*rm -rf*` style patterns.
- **`model-router`: per-project rules** - Load `.pi/model-rules.json` as a project-level
  override on top of `~/.pi/model-rules.json`, same precedence as `PI.md`.
- **`model-router`: Ollama mobile path** - Ollama won't work on mobile; consider
  Transformers.js (ONNX) as a portable embedded classifier for cross-platform use.
- **`fetch-url`: respect `robots.txt`** - Currently ignores it. Add a flag to enable/disable.
- **`mcp-integration`: auth headers** - `~/.pi/mcp.json` has no auth field. Add optional
  `headers` per server for bearer tokens.
- **`context-manager`: custom summary strategy** - Currently just logs and lets Pi compact
  normally. Could return a structured summary from `session_before_compact` to control what
  gets preserved.
- **Settings hot-reload** - Extensions read config once per call. Detect file changes and
  reload without restarting Pi.

### Infrastructure

- **`install.sh` uninstall** - Add a `--uninstall` flag that removes symlinks.
- **CI** - Run `bun test` on push. GitHub Actions workflow.
