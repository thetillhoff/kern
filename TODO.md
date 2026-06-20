# TODO

## Next Up

Nothing queued. See Backlog.

---

## Done This Session

- **`claude-compat` system prompt injection** - In-place mutation of `event.systemPrompt` was
  a no-op (runner rebuilds the event per handler from its own `currentSystemPrompt`, applies
  only the _returned_ `result.systemPrompt` - see `agent-session.js:818`). Now returns
  `{ systemPrompt }`; `unknown` casts dropped (`event.systemPrompt` is typed `string`).
- **`task` subagent tool** - New extension. Custom tool (not a slash command) the model
  orchestrates: spawns a fresh `createAgentSession`, runs `session.prompt()` to completion,
  returns the last assistant text. Params: `prompt`, optional `model_tier`
  (light/medium/heavy, reuses model-router's `model-rules.json` map), optional `tools`
  allowlist. `executionMode: "parallel"` so the model can fan out. Parent abort signal wired
  to `session.abort()`; `dispose()` in finally. Pi's tool-permission gate handles approve/deny.

- **Smoke test** - All 6 extensions load, model routing works end-to-end with real Pi
- **`modelRegistry.find()`** - Fixed: `getAll().find(m => m.id === modelName)` (API requires
  provider + id, workaround replaced)
- **`BeforeAgentStartEvent` shape** - Fixed: use `event.prompt` directly (not a messages array)
- **`getBranch()`** - Fixed everywhere: replaced with `getSessionId()` (returns string, not
  `SessionEntry[]`)
- **Ollama classifier** - Direct HTTP call to Ollama from model-router, replacing Python router
  middleman. Configurable via `/ollama` command at runtime
- **Provider-independent routing** - Tier names (`light`/`medium`/`heavy`) decoupled from model
  IDs; Bedrock EU model IDs in `~/.pi/model-rules.json`, Anthropic IDs in template
- **install.sh** - Single `extensions/` dir symlink instead of per-extension symlinks
- **Type errors** - Fixed across all extensions: fetch mock casts, `skipLibCheck`,
  `allowImportingTsExtensions`, `noThenProperty` (renamed `then` → `tier` in `RoutingRule`)

---

## Backlog

Things worth doing but not blocking immediate use.

### Pi extensions

- **`task`: live smoke test** - MVP built but only unit-tested (`lastAssistantText`). Verify
  end-to-end once Pi is running: spawn, model_tier resolution, tool allowlist, parallel calls,
  abort propagation.
- **`task`: stream child progress** - Currently silent until the child finishes. Could wire
  `onUpdate` to surface the subagent's intermediate output in the parent UI.
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
