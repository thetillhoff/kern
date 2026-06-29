# task extension — end-to-end smoke checks

Live verification of the subagent continuation engine against real Pi + AWS
Bedrock (the engine has no unit test because it needs a live model). Run from
the repo root with Bedrock credentials active:

```sh
export AWS_REGION=<your-aws-region>
export AWS_PROFILE=<your-aws-profile>
```

The `task` extension is loaded via the `~/.pi/agent/extensions` symlink.
Each child session writes its own log to `~/.pi/sessions/<childSessionId>.jsonl`.
After a run, find the child id in the terminal output and inspect its file directly.

Last verified: 2026-06-22, all three scenarios + orphan sweep green.

## 1. Basic delegation

```sh
timeout 90 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: SMOKE_OK'. Report what came back."
```

Output: `The subagent replied with: SMOKE_OK` (exit 0).

`~/.pi/sessions/<childId>.jsonl`:

```json
{"...","model":"pending","tokens":0,"status":"spawned","durationMs":0}
{"...","model":"eu.anthropic.claude-haiku-...","tokens":2601,"status":"completed","durationMs":3455}
```

Confirms: spawn + completion, token accounting populated on completion.

## 2. ask-caller / resume round trip (core feature)

```sh
timeout 150 pi -p --no-session --tools task \
"Delegate via the task tool a subagent with this prompt: 'You do not know the deploy target environment. Call the ask-caller tool to ask your caller: which environment? Then reply with ONLY that environment name and nothing else.' When the subagent asks its question, the answer is 'staging' - deliver it by calling task again with resume set to the returned subagent id and answer set to 'staging'. Finally report the single word the subagent returned."
```

Output: `staging` (exit 0).

`~/.pi/sessions/<childId>.jsonl`:

```json
{"...","tokens":0,"status":"spawned","durationMs":0}
{"...","tokens":2680,"status":"asked","durationMs":1214}
{"...","tokens":2680,"status":"answered","durationMs":2650}
{"...","tokens":5413,"status":"completed","durationMs":3578}
```

Confirms: the child suspends inside `ask-caller`, the parent LLM receives the
question and resumes with an answer, the child wakes and finishes. The shared
registry handshake (child `ctx.sessionManager.getSessionId()` equals the
parent-stored `session.sessionId`) holds. Tokens accumulate across resume
segments (2680 → 5413).

## 3. Timeout guard

```sh
timeout 90 pi -p --no-session --tools task \
"Use the task tool with timeout_ms set to 1 to delegate this prompt: 'Write a detailed 500 word essay about distributed consensus algorithms.' Then report the exact status field you received back from the task tool."
```

Output: tool returned `Subagent timed out after 1ms.` (exit 0). The structured
`details.status` is `"timeout"`; the model only surfaces the text content.

`~/.pi/sessions/<childId>.jsonl`:

```json
{"...","tokens":0,"status":"spawned","durationMs":0}
{"...","tokens":0,"status":"timeout","durationMs":2}
```

Confirms: a run segment exceeding `timeout_ms` aborts and disposes the child
(entry removed from the registry), and the parent run itself still exits 0.

## Explicit-first routing (verified 2026-06-21)

The router is the single model selector for every session: explicit (subagent
tier override or human-pinned model) → Ollama classifier → light fallback.
Preset keyword/token rules were removed. The session log and the tool
`details` carry the actual model; `~/.pi/model-decisions.jsonl` is the debug
trace of the router's reasoning. (During these runs the Ollama classifier
returned no usable tier, so the no-explicit path logged `reason:"fallback"` →
light, which is the correct degraded behavior.)

### Subagent explicit tier wins

```sh
timeout 120 pi -p --no-session --tools task \
"Call the task tool with arguments prompt='Reply with only: HEAVY_OK' and model_tier='heavy'. Report what it returned."
```

`~/.pi/sessions/<childId>.jsonl` `completed` shows the heavy model;
`model-decisions.jsonl` shows `tier:"heavy", reason:"explicit"` for the child -
the explicit tier beat the router's own classification.

```json
{"...","model":"eu.anthropic.claude-opus-4-6-v1","status":"completed"}
{"...","session":"<child>","tier":"heavy","model":"eu.anthropic.claude-opus-4-6-v1","reason":"explicit"}
```

### Subagent default goes through the router

```sh
timeout 120 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: DEFAULT_OK'. Report what came back."
```

`~/.pi/sessions/<childId>.jsonl` `completed` logs the ACTUAL routed model (not
`"pending"`); `model-decisions.jsonl` shows `reason:"ollama"` or `"fallback"`.

### Human launch `--model` is honored (pinned)

```sh
pi -p --no-session --model "eu.anthropic.claude-opus-4-6-v1" "Reply with only: PIN_OK"
```

`model-decisions.jsonl` shows `reason:"explicit"` with the opus model - the
router did NOT override the human's `--model`. A launch flag emits no
`model_select` event, so the router detects it by comparing the live model to
`settings.json`'s `defaultModel` baseline.

### Plain launch still routes (no false pin)

```sh
pi -p --no-session "Reply with only: PLAIN_OK"
```

`model-decisions.jsonl` shows `reason:"ollama"`/`"fallback"` (NOT `explicit`) -
the startup model equals the settings default, so the baseline check does not
mis-pin it and normal routing runs.

### Classifier warmup + latency logging

The classifier model cold-loads slowly (qwen2.5-coder:7b: ~14s cold vs
~0.5-1.3s warm), while the routing gate is `classifierTimeoutMs` (2000ms). Two
mitigations:

- **Warmup on typing:** `model-router` registers `ctx.ui.onTerminalInput` in
  `session_start`; the first keystroke (throttled to once per 60s) fires a
  fire-and-forget `/api/generate` so the model is warm by submit time.
- **Always measure:** the 2s gate only bounds *routing*. `callOllama` returns
  `{tier, latencyMs}` and keeps running (up to a 60s safety cap) when the gate
  is exceeded; the late result is logged as `reason:"ollama-late"` with its
  real latency, so evaluation sees how long it would have taken even on a
  fallback. (In `pi -p` the process may exit before the late call finishes;
  `ollama-late` is captured in longer-lived interactive sessions.)

Warm verification:

```sh
curl -s http://localhost:11434/api/generate -d '{"model":"qwen2.5-coder:7b","prompt":"","stream":false}' >/dev/null   # warm
pi -p --no-session "Design a fault-tolerant distributed queue and explain the tradeoffs"
```

`model-decisions.jsonl` shows the real classifier latency:

```json
{"...","tier":"heavy","model":"eu.anthropic.claude-opus-4-6-v1","reason":"ollama","latencyMs":758}
```
