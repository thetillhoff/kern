# task extension — end-to-end smoke checks

Live verification of the subagent continuation engine against real Pi + AWS
Bedrock (the engine has no unit test because it needs a live model). Run from
the repo root with Bedrock credentials active:

```sh
export AWS_REGION=eu-central-1
export AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer"
```

The `task` extension is loaded via the `~/.pi/agent/extensions` symlink.
Each run truncates `~/.pi/subagent.jsonl` first to isolate its log lines.

Last verified: 2026-06-21, all three scenarios green.

## 1. Basic delegation

```sh
timeout 90 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: SMOKE_OK'. Report what came back."
```

Output: `The subagent replied with: SMOKE_OK` (exit 0).

`subagent.jsonl`:

```json
{"...","childSession":"019eea25-4070-...","model":"default","tokens":0,"status":"spawned","durationMs":0}
{"...","childSession":"019eea25-4070-...","model":"default","tokens":2601,"status":"completed","durationMs":3455}
```

Confirms: spawn + completion, token accounting populated on completion.

## 2. ask-caller / resume round trip (core feature)

```sh
timeout 150 pi -p --no-session --tools task \
"Delegate via the task tool a subagent with this prompt: 'You do not know the deploy target environment. Call the ask-caller tool to ask your caller: which environment? Then reply with ONLY that environment name and nothing else.' When the subagent asks its question, the answer is 'staging' - deliver it by calling task again with resume set to the returned subagent id and answer set to 'staging'. Finally report the single word the subagent returned."
```

Output: `staging` (exit 0).

`subagent.jsonl` (one child id throughout):

```json
{"...","childSession":"019eea25-a2da-...","tokens":0,"status":"spawned","durationMs":0}
{"...","childSession":"019eea25-a2da-...","tokens":2680,"status":"asked","durationMs":1214}
{"...","childSession":"019eea25-a2da-...","tokens":2680,"status":"answered","durationMs":2650}
{"...","childSession":"019eea25-a2da-...","tokens":5413,"status":"completed","durationMs":3578}
```

Confirms: the child suspends inside `ask-caller`, the parent LLM receives the
question and resumes with an answer, the child wakes and finishes. The shared
registry handshake (child `ctx.sessionManager.getSessionId()` equals the
parent-stored `session.sessionId`) holds — the same child id appears in every
line. Tokens accumulate across resume segments (2680 → 5413).

## 3. Timeout guard

```sh
timeout 90 pi -p --no-session --tools task \
"Use the task tool with timeout_ms set to 1 to delegate this prompt: 'Write a detailed 500 word essay about distributed consensus algorithms.' Then report the exact status field you received back from the task tool."
```

Output: tool returned `Subagent timed out after 1ms.` (exit 0). The structured
`details.status` is `"timeout"`; the model only surfaces the text content.

`subagent.jsonl`:

```json
{"...","childSession":"019eea25-f620-...","tokens":0,"status":"spawned","durationMs":0}
{"...","childSession":"019eea25-f620-...","tokens":0,"status":"timeout","durationMs":2}
```

Confirms: a run segment exceeding `timeout_ms` aborts and disposes the child
(entry removed from the registry), and the parent run itself still exits 0.

## Explicit-first routing (verified 2026-06-21)

The router is the single model selector for every session: explicit (subagent
tier override or human-pinned model) → Ollama classifier → light fallback.
Preset keyword/token rules were removed. `~/.pi/subagent.jsonl` and the tool
`details` carry the actual model; `~/.pi/model-decisions.jsonl` is the debug
trace of the router's reasoning. (During these runs the Ollama classifier
returned no usable tier, so the no-explicit path logged `reason:"fallback"` →
light, which is the correct degraded behavior.)

### Subagent explicit tier wins

```sh
timeout 120 pi -p --no-session --tools task \
"Call the task tool with arguments prompt='Reply with only: HEAVY_OK' and model_tier='heavy'. Report what it returned."
```

`subagent.jsonl` `completed` shows the heavy model; `model-decisions.jsonl`
shows `tier:"heavy", reason:"explicit"` for the child - the explicit tier beat
the router's own classification.

```json
{"...","childSession":"...","model":"eu.anthropic.claude-opus-4-6-v1","status":"completed"}
{"...","session":"<child>","tier":"heavy","model":"eu.anthropic.claude-opus-4-6-v1","reason":"explicit"}
```

### Subagent default goes through the router

```sh
timeout 120 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: DEFAULT_OK'. Report what came back."
```

`subagent.jsonl` `completed` logs the ACTUAL routed model (not `"default"`/
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
