# TODO

## Next Up

These are the immediate next things to do to make the system actually usable.

### 1. End-to-end smoke test

- Run `./install.sh`
- Start Pi and verify each extension loads (check for error messages in Pi startup)
- Send a short message (< 300 tokens, no complex keywords) → confirm `model-decisions.jsonl` shows `reason: "rule"`, tier `light`, model `claude-haiku-4-5`
- Send a large or architecture-focused message → confirm tier `heavy`, model `claude-opus-4-8`
- Default messages (no rule match) → confirm tier falls back to `claude-sonnet-4-6`

Optional: to test the Python router classifier, add `classifierUrl` to `~/.pi/model-rules.json`
and start the router (`cd router && uvicorn app:app`).

### 2. Fix `before_agent_start` system prompt injection in `claude-compat`

The Pi extension API for mutating the system prompt in `before_agent_start` is cast via
`unknown` in `index.ts`. Verify this actually works once Pi is running - the event shape
may differ. Consult Pi source or examples if it silently no-ops.

### 3. Fix `modelRegistry.find()` call in `model-router`

`ctx.modelRegistry.find(undefined, modelName)` is a workaround - the real API may require
provider + model. Verify against Pi source and fix the signature.

---

## Code Review Findings

All 15 issues resolved.

---

## Backlog

Things worth doing but not blocking immediate use.

### Pi extensions

- **Subagent stub** - Register `/subagent` command that prints "not yet implemented" with a
  note on what it would do. Currently nothing is registered.
- **`safe-bash`: blocklist wildcards at the start** - Current pattern matching requires the
  wildcard to be at the end (`rm -rf *`). Add support for `*rm -rf*` style patterns.
- **`model-router`: per-project rules** - Load `.pi/model-rules.json` as a project-level
  override on top of `~/.pi/model-rules.json`, same precedence as `PI.md`.
- **`fetch-url`: respect `robots.txt`** - Currently ignores it. Add a flag to enable/disable.
- **`mcp-integration`: auth headers** - `~/.pi/mcp.json` has no auth field. Add optional
  `headers` per server for bearer tokens.
- **`context-manager`: custom summary strategy** - Currently just logs and lets Pi compact
  normally. Could return a structured summary from `session_before_compact` to control what
  gets preserved.
- **Settings hot-reload** - Extensions read config once per call. Detect file changes and
  reload without restarting Pi.

### Python router

- **End-to-end integration test** - Pull real models, start the router, send requests, assert
  `X-Router-Tier` header is correct. Currently only unit tests with mocked backends.
- **Request logging** - Log which tier was selected, latency, and model used per request.
  Output as JSONL for easy parsing.
- **Gemini Flash tier** - Add a `medium-fast` tier using Gemini Flash as a cheap, fast
  option between local and Sonnet.
- **Classifier prompt tuning** - The current system prompt is minimal. Tune with real examples
  of local/medium/heavy requests.

### Infrastructure

- **`install.sh` uninstall** - Add a `--uninstall` flag that removes symlinks.
- **CI** - Run `bun test` and `pytest` on push. GitHub Actions workflow.
