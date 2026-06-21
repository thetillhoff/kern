# Router Explicit-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the model-router the single model selector for every session (root and subagent): an explicit model/tier always wins, otherwise the Ollama classifier decides, otherwise a light fallback. Remove the preset keyword/token rules. Log/return the actual model used.

**Architecture:** `before_agent_start` runs on every session. Precedence: explicit (subagent tier override OR human-pinned model) → Ollama classifier → light fallback (`models.light`). A new in-process `override.ts` (owned by model-router, imported by task) carries subagent tier overrides and human-pin state. The actual model (`session.model`) is the workflow value, logged to `~/.pi/subagent.jsonl` and returned in tool `details`; `~/.pi/model-decisions.jsonl` stays a debug trace.

**Tech Stack:** TypeScript, Bun test, `@earendil-works/pi-coding-agent` SDK, Biome (tabs).

## Global Constraints

- Tests: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test <file>`.
- Repo uses Biome default config (TABS); run `npx @biomejs/biome format --write <files>` then `npx @biomejs/biome check <dir>` after edits. `.ts` import extensions.
- Implementers do NOT commit; the orchestrator verifies and commits.
- Git: `cd <path> && git <cmd>`, never `git -C`.
- `model-rules.json` `models` map keys are `light`/`medium`/`heavy`; the Ollama-down fallback uses `models.light`.
- Router decision reasons after this change: `"explicit" | "ollama" | "fallback"`.

---

## Task 1: model-router explicit-first rewrite

Remove preset rules; add the override module; rewrite routing precedence; pin human selections; log the actual model. Delete `model-router/rules.ts` and `model-router/rules.test.ts` (the keyword/token rules). `decision.ts`/`currentModelId` stays.

**Files:**

- Create: `extensions/model-router/override.ts`
- Test: `extensions/model-router/override.test.ts`
- Modify: `extensions/model-router/index.ts` (RouterConfig, before_agent_start, model_select handler)
- Modify: `extensions/model-router/logger.ts` (reason union)
- Delete: `extensions/model-router/rules.ts`, `extensions/model-router/rules.test.ts`

**Interfaces:**

- Produces: `setTierOverride(sessionId: string, tier: string): void`
- Produces: `takeTierOverride(sessionId: string): string | undefined` (get-and-delete)
- Produces: `pinSession(sessionId: string): void`, `isPinned(sessionId: string): boolean`
- Produces: `noteRouterSet(sessionId: string, modelId: string): void` and `wasRouterSet(sessionId: string, modelId: string): boolean` (so the model_select handler can ignore the router's own sets)
- `RouterDecision.reason` becomes `"explicit" | "ollama" | "fallback"`.

- [ ] **Step 1: Write the failing test for the override module**

Create `extensions/model-router/override.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  isPinned,
  noteRouterSet,
  pinSession,
  setTierOverride,
  takeTierOverride,
  wasRouterSet,
} from "./override.ts";

test("takeTierOverride returns then clears the override", () => {
  setTierOverride("s1", "heavy");
  expect(takeTierOverride("s1")).toBe("heavy");
  expect(takeTierOverride("s1")).toBeUndefined();
});

test("pinSession marks a session pinned", () => {
  expect(isPinned("s2")).toBe(false);
  pinSession("s2");
  expect(isPinned("s2")).toBe(true);
});

test("wasRouterSet matches only the last router-set model for a session", () => {
  noteRouterSet("s3", "haiku");
  expect(wasRouterSet("s3", "haiku")).toBe(true);
  expect(wasRouterSet("s3", "opus")).toBe(false);
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/override.test.ts`
Expected: FAIL - `Cannot find module './override.ts'`.

- [ ] **Step 3: Implement the override module**

Create `extensions/model-router/override.ts`:

```ts
// In-process model-selection state shared across sessions (one Node process).
// model-router owns this; the task extension imports setTierOverride to pass an
// explicit subagent tier into a child session's routing.

// sessionId -> tier requested by a task() call for that child session.
const tierOverrides = new Map<string, string>();
// sessions whose model the human pinned (explicit selection); router skips them.
const pinnedSessions = new Set<string>();
// sessionId -> the model id the router itself last set, so the model_select
// handler can distinguish the router's own setModel from a human selection.
const routerSet = new Map<string, string>();

export function setTierOverride(sessionId: string, tier: string): void {
  tierOverrides.set(sessionId, tier);
}

export function takeTierOverride(sessionId: string): string | undefined {
  const tier = tierOverrides.get(sessionId);
  tierOverrides.delete(sessionId);
  return tier;
}

export function pinSession(sessionId: string): void {
  pinnedSessions.add(sessionId);
}

export function isPinned(sessionId: string): boolean {
  return pinnedSessions.has(sessionId);
}

export function noteRouterSet(sessionId: string, modelId: string): void {
  routerSet.set(sessionId, modelId);
}

export function wasRouterSet(sessionId: string, modelId: string): boolean {
  return routerSet.get(sessionId) === modelId;
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/override.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the reason union**

In `extensions/model-router/logger.ts`, set:

```ts
  reason: "explicit" | "ollama" | "fallback";
```

- [ ] **Step 6: Rewrite the router**

In `extensions/model-router/index.ts`:

- Remove `import { applyRules, estimateTokens, type RoutingRule } from "./rules.ts";` and add:

```ts
import {
  isPinned,
  noteRouterSet,
  pinSession,
  setTierOverride,
  takeTierOverride,
  wasRouterSet,
} from "./override.ts";
import { currentModelId } from "./decision.ts";
```

(`setTierOverride` is re-exported for the task extension; keep the import or add `export { setTierOverride } from "./override.ts";` so task can import it from either path - simplest is task imports directly from `model-router/override.ts`, so you do NOT need to re-export. Remove `setTierOverride` from this import list if unused here.)

- Remove `rules: RoutingRule[];` from `RouterConfig` and the `rules: []` defaults in `loadConfig`'s two return objects.

- Replace the entire `pi.on("before_agent_start", ...)` body with the explicit-first flow:

```ts
  pi.on("before_agent_start", async (_event, ctx) => {
    const config = loadConfig(rulesPath);
    const session = ctx.sessionManager.getSessionId();
    const start = Date.now();

    async function setModelByTier(
      tier: string,
      reason: "explicit" | "ollama" | "fallback",
    ): Promise<void> {
      const modelName = config.models?.[tier] ?? config.defaultModel;
      if (modelName) {
        const model = ctx.modelRegistry
          .getAll()
          .find((m) => m.id === modelName);
        if (model) {
          noteRouterSet(session, modelName);
          await pi.setModel(model);
        } else {
          console.warn(`[model-router] model not found: ${modelName}`);
        }
      }
      appendDecision(logPath, {
        ts: new Date().toISOString(),
        session,
        tier,
        model: modelName ?? "unknown",
        reason,
        latencyMs: Date.now() - start,
      });
    }

    // 1. Explicit subagent tier override (from a task() call). Hard win.
    const overrideTier = takeTierOverride(session);
    if (overrideTier) {
      await setModelByTier(overrideTier, "explicit");
      return;
    }

    // 2. Human-pinned session: keep whatever model the human selected.
    if (isPinned(session)) {
      appendDecision(logPath, {
        ts: new Date().toISOString(),
        session,
        tier: "explicit",
        model: currentModelId(
          ctx.model as { id?: string } | undefined,
          config.defaultModel,
        ),
        reason: "explicit",
        latencyMs: Date.now() - start,
      });
      return;
    }

    // 3. Ollama classifier.
    if (config.ollamaUrl && config.ollamaModel) {
      const tier = await callOllama(
        config.ollamaUrl,
        config.ollamaModel,
        _event.prompt,
        config.classifierTimeoutMs ?? 2000,
      );
      if (tier) {
        await setModelByTier(tier, "ollama");
        return;
      }
    }

    // 4. Fallback to the light model when no classifier answer.
    await setModelByTier("light", "fallback");
  });

  // Pin a session when the human (not the router) selects a model.
  pi.on("model_select", (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    const modelId = (event.model as { id?: string }).id ?? "";
    if (wasRouterSet(session, modelId)) return; // the router's own set
    if (event.source === "set" || event.source === "cycle") {
      pinSession(session);
    }
  });
```

Keep the existing `/ollama` command handler unchanged. Keep `loadConfig`/`saveConfig`/`RouterConfig` (minus `rules`).

- [ ] **Step 7: Delete the rules module and its test**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git rm extensions/model-router/rules.ts extensions/model-router/rules.test.ts
```

(If the implementer cannot run `git rm`, delete the two files from the working tree; the orchestrator stages the deletion.)

- [ ] **Step 8: Verify**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/ && npx tsc --noEmit && npx @biomejs/biome check model-router/`
Expected: override + decision + classifier + logger tests pass; no `rules.test.ts`; tsc clean; biome clean (pre-existing infos ok).

- [ ] **Step 9: Report** (no commit). Write to the report file: what changed, RED/GREEN for override.test.ts, the three verification outputs, confirmation `rules.ts`/`rules.test.ts` are gone and no remaining import references them.

---

## Task 2: task uses the router for model selection

`task` stops pre-resolving a model; it passes an explicit tier to the child's router via `setTierOverride`, and logs/returns the actual `session.model`.

**Files:**

- Modify: `extensions/task/index.ts`

**Interfaces:**

- Consumes: `setTierOverride` from `../model-router/override.ts`.
- The tool result `details` gains `model` (the actual model id).

- [ ] **Step 1: Rewire spawning**

In `extensions/task/index.ts`:

- Add `import { setTierOverride } from "../model-router/override.ts";`
- Remove the `tierModelId`/`resolveTierModel` helpers and the `RegistryModel` type and their imports IF now unused (they were only used to pre-set the child model). Keep `lastAssistantText` and its test.
- In `execute`, the fresh-spawn path: build the child WITHOUT a `model` option:

```ts
      const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        agentDir: join(homedir(), ".pi", "agent"),
        systemPrompt: ctx.getSystemPrompt(),
        appendSystemPrompt: SUBAGENT_APPEND_PROMPT,
      });
      await loader.reload();
      // ... askCaller unchanged ...
      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        resourceLoader: loader,
        customTools: [askCaller],
        ...(augmentTools(params.tools) ? { tools: augmentTools(params.tools) } : {}),
      });
      session.extensionRunner.setUIContext(ctx.ui, ctx.mode);
      const childId = session.sessionId;
      // Explicit tier (optional) overrides the child router; otherwise the
      // child router classifies the child prompt itself.
      if (params.model_tier) setTierOverride(childId, params.model_tier);
```

- `ChildEntry.model`: set it to the ACTUAL model after routing. At spawn time the model is not yet chosen, so initialise `entry.model = "pending"`, and in `runSegment` set `entry.model = entry.session.model?.id ?? entry.model;` immediately after the race resolves (before logging), so completed/asked/timeout/aborted log the real model. The `spawned` log line may show `"pending"` (acceptable - the real model appears on the next event).

- Add `model: entry.model` to every `runSegment` return's `details` object.

- [ ] **Step 2: Verify**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/ && npx tsc --noEmit && npx @biomejs/biome check task/`
Expected: existing task tests pass; tsc clean; biome clean.

- [ ] **Step 3: Report** (no commit): what changed, the three verification outputs, confirm `resolveTierModel`/`tierModelId` removal left no dangling references.

---

## Task 3: re-smoke (live Bedrock) and update SMOKE.md

Verify the redesigned behavior end-to-end. Credentials: `AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer"`.

**Files:**

- Modify: `extensions/task/SMOKE.md` (add the explicit-first checks)

- [ ] **Step 1: Tier override beats a contrary classifier**

```bash
: > ~/.pi/subagent.jsonl
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 120 pi -p --no-session --tools task \
"Use the task tool with model_tier set to 'heavy' to delegate this prompt: 'grep the files and reply with only: TIER_OK'. Report what came back." 2>&1
```

Expected: reply `TIER_OK`; `~/.pi/subagent.jsonl` `completed` line shows the heavy model id (e.g. opus), NOT a light/haiku model - i.e. the explicit `heavy` won even though the prompt mentions `grep`. `~/.pi/model-decisions.jsonl` shows a `reason:"explicit"` line for the child session.

- [ ] **Step 2: Default (no tier) uses the router**

```bash
: > ~/.pi/subagent.jsonl
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 120 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: DEFAULT_OK'. Report what came back." 2>&1
```

Expected: reply `DEFAULT_OK`; `subagent.jsonl` `completed` shows the ACTUAL model the router chose (a real id, not `"default"`); `model-decisions.jsonl` shows `reason:"ollama"` or `reason:"fallback"` for the child.

- [ ] **Step 3: Human launch --model pins (verification, may need a follow-up)**

```bash
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 90 pi -p --no-session --model "eu.anthropic.claude-opus-4-6-v1" \
"Reply with only: PIN_OK" 2>&1
tail -2 ~/.pi/model-decisions.jsonl
```

Expected: reply `PIN_OK`; the root decision logs `reason:"explicit"` and the opus model (the router did NOT override the human's `--model`). **If instead it logs `ollama`/`fallback` with a different model, the launch `--model` did not emit a `model_select` event** - record this in SMOKE.md as a known limitation and open a backlog item to add a first-turn heuristic (pin when the starting model differs from `config.defaultModel`). Do NOT block the task on it.

- [ ] **Step 4: Update SMOKE.md** with the three checks above and their observed output. Lint: `cd /Users/tillhoffmann/code/thetillhoff/kern && npx markdownlint-cli --disable MD013 -- extensions/task/SMOKE.md`.

- [ ] **Step 5: Report** (no commit): paste the observed outputs and the explicit verdict on whether launch `--model` pinning worked.

---

## Self-Review

- Explicit-first precedence (override → pinned → ollama → fallback): Task 1 Step 6. ✓
- Preset rules removed: Task 1 Steps 2, 7. ✓
- Ollama → light fallback (`models.light`): Task 1 Step 6 branch 4. ✓
- Subagent explicit tier wins: Task 1 (override consumed first) + Task 2 (setTierOverride). ✓
- Human-pinned model wins: Task 1 model_select handler + isPinned branch. Launch `--model` verified in Task 3 Step 3 (with a documented fallback if the event doesn't fire). ✓
- Actual model logged + returned: Task 2 (entry.model from session.model, details.model) + Task 1 (decisions log the set model). ✓
- model-decisions.jsonl is debug-only: unchanged role; subagent.jsonl/details carry the workflow model. ✓
- Type consistency: `setTierOverride`/`takeTierOverride`/`pinSession`/`isPinned`/`noteRouterSet`/`wasRouterSet` names match between Task 1 (definition) and Task 2 (consumes `setTierOverride`); reason union `"explicit"|"ollama"|"fallback"` matches between `logger.ts` and `index.ts`.
- Known risk: launch `--model` pinning depends on a startup `model_select` event; Task 3 Step 3 verifies and documents a fallback. Cross-extension import `task → model-router/override.ts` is a new dependency edge (task already reuses model-router's config).
