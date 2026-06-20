# Subagent Escalation, Context Inheritance & Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let subagents ask their caller questions, route permission prompts to the human via a shared-grant allowlist, sum token usage into the UI, inherit the parent's system prompt, bound runtime with a parent-set timeout, and fix two model-router logging defects.

**Architecture:** All Pi sessions run in one Node process, so the `task` extension keeps a module-level registry shared across parent and child sessions. `task.execute` no longer awaits the child to completion - it races the child's run against a question signal and a timeout, returning control to the parent LLM when the child asks. The child's `ask-caller` tool (injected only into children via `customTools`) suspends the child until the parent resumes it with an answer. Permission prompts forward through `setUIContext(parent ui)` straight to the human; `safe-bash` reuses the static allowlist as the shared, persisted grant store.

**Tech Stack:** TypeScript, Bun test runner, `@earendil-works/pi-coding-agent` SDK, TypeBox schemas.

## Global Constraints

- Tests run with `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test <file>`.
- TypeScript imports use `.ts` extensions (repo has `allowImportingTsExtensions`).
- Log files are append-only JSONL under `~/.pi/`, one JSON object per line, mirroring `model-router/logger.ts`.
- All git commands use `cd /Users/tillhoffmann/code/thetillhoff/kern && git <cmd>` (never `git -C`). Per the repo owner's CLAUDE.md, git commits are run by the orchestrator between tasks, not from inside an execution skill.
- No Python anywhere in this work; nothing to containerize.
- `ask-caller` is the exact tool name (hyphenated). The registry is keyed by child `sessionId`.

---

## Task 1: model-router logging fixes

Two independent defects: the default branch logs `config.defaultModel` even when the real session model differs, and a failed Ollama classifier is indistinguishable from "no classifier configured".

**Files:**

- Modify: `extensions/model-router/logger.ts` (extend `reason` union)
- Modify: `extensions/model-router/index.ts:110-121` (default branch model + ollama-failed)
- Create: `extensions/model-router/decision.ts` (extracted pure helper)
- Test: `extensions/model-router/decision.test.ts`

**Interfaces:**

- Produces: `currentModelId(model: { id?: string } | undefined, defaultModel: string | null): string` - returns the real model id if present, else the configured default, else `"unknown"`.
- Produces: `RouterDecision.reason` union gains `"ollama-failed"`.

- [ ] **Step 1: Write the failing test**

Create `extensions/model-router/decision.test.ts`:

```ts
import { expect, test } from "bun:test";
import { currentModelId } from "./decision.ts";

test("prefers the live model id over the configured default", () => {
  expect(currentModelId({ id: "haiku" }, "sonnet")).toBe("haiku");
});

test("falls back to the configured default when no live model", () => {
  expect(currentModelId(undefined, "sonnet")).toBe("sonnet");
});

test("returns 'unknown' when nothing is available", () => {
  expect(currentModelId(undefined, null)).toBe("unknown");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/decision.test.ts`
Expected: FAIL - `Cannot find module './decision.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `extensions/model-router/decision.ts`:

```ts
// Pick the model id to record in the decision log.
// The live session model wins so a model set elsewhere (e.g. the task tool)
// is reported truthfully; only then fall back to the configured default.
export function currentModelId(
  model: { id?: string } | undefined,
  defaultModel: string | null,
): string {
  return model?.id ?? defaultModel ?? "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/decision.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper and the ollama-failed reason**

In `extensions/model-router/logger.ts`, extend the union:

```ts
  reason: "rule" | "ollama" | "ollama-failed" | "classifier" | "default";
```

In `extensions/model-router/index.ts`, add the import near the top:

```ts
import { currentModelId } from "./decision.ts";
```

Replace the Tier 2 block (the `if (config.ollamaUrl && config.ollamaModel) { ... }` at lines 88-108) with a version that logs `ollama-failed` when the classifier was configured but returned nothing:

```ts
    // Tier 2: Ollama classifier
    if (config.ollamaUrl && config.ollamaModel) {
      const tier = await callOllama(
        config.ollamaUrl,
        config.ollamaModel,
        lastMessage,
        config.classifierTimeoutMs ?? 2000,
      );
      if (tier) {
        const modelName = config.models?.[tier] ?? config.defaultModel;
        if (modelName) await setModelByName(modelName);
        appendDecision(logPath, {
          ts: new Date().toISOString(),
          session,
          tier,
          model: modelName ?? "unknown",
          reason: "ollama",
          latencyMs: Date.now() - start,
        });
        return;
      }
      // Classifier ran but produced no usable tier: record the failure
      // instead of silently falling through to the default reason.
      appendDecision(logPath, {
        ts: new Date().toISOString(),
        session,
        tier: "default",
        model: currentModelId(
          ctx.model as { id?: string } | undefined,
          config.defaultModel,
        ),
        reason: "ollama-failed",
        latencyMs: Date.now() - start,
      });
      return;
    }
```

Replace the Tier 3 default block (lines 110-121) so it logs the real model:

```ts
    // Tier 3: default — no model change; Pi uses whatever is configured
    appendDecision(logPath, {
      ts: new Date().toISOString(),
      session,
      tier: "default",
      model: currentModelId(
        ctx.model as { id?: string } | undefined,
        config.defaultModel,
      ),
      reason: "default",
      latencyMs: Date.now() - start,
    });
```

- [ ] **Step 6: Run the full extension suite**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test model-router/ && npx tsc --noEmit`
Expected: all model-router tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/model-router/decision.ts extensions/model-router/decision.test.ts extensions/model-router/logger.ts extensions/model-router/index.ts && git commit -m "fix(model-router): log real model on default path, distinguish ollama-failed"
```

---

## Task 2: safe-bash shared "Allow always" grant

Replace the boolean confirm with a three-way choice. "Allow always" lets the human edit a suggested pattern, then appends it to the shared `bashSafety.allowlist` in `settings.json`, which every session re-reads each `tool_call`.

**Files:**

- Modify: `extensions/safe-bash/rules.ts` (add `suggestPattern`)
- Create: `extensions/safe-bash/allowlist.ts` (`appendAllowlistPattern`)
- Test: `extensions/safe-bash/allowlist.test.ts`
- Modify: `extensions/safe-bash/index.ts:46-52` (select + editor + append)
- Modify: `extensions/safe-bash/rules.test.ts` (add suggestPattern cases)

**Interfaces:**

- Produces: `suggestPattern(command: string): string` - the first whitespace token plus a trailing glob (e.g. `"git push x"` → `"git *"`).
- Produces: `appendAllowlistPattern(settingsPath: string, pattern: string): void` - reads the JSON, appends `pattern` to `bashSafety.allowlist` (creating the structure if absent), writes it back; no-op if the pattern is already present.

- [ ] **Step 1: Write the failing test for suggestPattern**

Append to `extensions/safe-bash/rules.test.ts`:

```ts
import { suggestPattern } from "./rules.ts";

test("suggestPattern globs the first token", () => {
  expect(suggestPattern("git push origin main")).toBe("git *");
  expect(suggestPattern("  rm -rf foo  ")).toBe("rm *");
});
```

(Keep the existing `import` line for `matchesAny`/`matchesPattern`; add `suggestPattern` to it instead if the file imports from `./rules.ts` already.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts`
Expected: FAIL - `suggestPattern is not a function`.

- [ ] **Step 3: Implement suggestPattern**

Append to `extensions/safe-bash/rules.ts`:

```ts
/**
 * Suggest an allowlist glob for a command: the first token plus " *".
 * The human edits this before it is stored, so a broad default is fine.
 */
export function suggestPattern(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return `${first} *`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for appendAllowlistPattern**

Create `extensions/safe-bash/allowlist.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAllowlistPattern } from "./allowlist.ts";

function tmpSettings(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "safebash-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, contents, "utf-8");
  return path;
}

test("appends a new pattern to an existing allowlist", () => {
  const path = tmpSettings(
    JSON.stringify({ bashSafety: { allowlist: ["ls *"] } }),
  );
  appendAllowlistPattern(path, "git *");
  const after = JSON.parse(readFileSync(path, "utf-8"));
  expect(after.bashSafety.allowlist).toEqual(["ls *", "git *"]);
});

test("creates the bashSafety structure when missing", () => {
  const path = tmpSettings(JSON.stringify({ theme: "dark" }));
  appendAllowlistPattern(path, "git *");
  const after = JSON.parse(readFileSync(path, "utf-8"));
  expect(after.theme).toBe("dark");
  expect(after.bashSafety.allowlist).toEqual(["git *"]);
});

test("is a no-op when the pattern already exists", () => {
  const path = tmpSettings(
    JSON.stringify({ bashSafety: { allowlist: ["git *"] } }),
  );
  appendAllowlistPattern(path, "git *");
  const after = JSON.parse(readFileSync(path, "utf-8"));
  expect(after.bashSafety.allowlist).toEqual(["git *"]);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test safe-bash/allowlist.test.ts`
Expected: FAIL - `Cannot find module './allowlist.ts'`.

- [ ] **Step 7: Implement appendAllowlistPattern**

Create `extensions/safe-bash/allowlist.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";

interface Settings {
  bashSafety?: { allowlist?: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

// Append a glob to bashSafety.allowlist in settings.json, preserving the rest
// of the file. The allowlist is the shared, persisted grant store: every
// session (and subagent) re-reads it on each tool_call.
export function appendAllowlistPattern(
  settingsPath: string,
  pattern: string,
): void {
  let settings: Settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Settings;
  } catch {
    settings = {};
  }
  const safety = (settings.bashSafety ??= {});
  const allowlist = (safety.allowlist ??= []);
  if (!allowlist.includes(pattern)) {
    allowlist.push(pattern);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test safe-bash/allowlist.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Wire the three-way prompt in index.ts**

In `extensions/safe-bash/index.ts`, update the imports:

```ts
import { matchesAny, suggestPattern } from "./rules.ts";
import { appendAllowlistPattern } from "./allowlist.ts";
```

Replace the `requireConfirmForUnknown` block (lines 46-52) with:

```ts
    if (rules.requireConfirmForUnknown) {
      const choice = await ctx.ui.select(
        "Bash approval required",
        ["Allow once", "Allow always", "Deny"],
        {},
      );
      if (choice === "Allow always") {
        const edited = await ctx.ui.editor(
          "Allowlist pattern (edit before saving)",
          suggestPattern(command),
        );
        if (edited && edited.trim()) {
          appendAllowlistPattern(settingsPath, edited.trim());
          return; // approved and persisted
        }
        return { block: true, reason: "User cancelled allow-always" };
      }
      if (choice !== "Allow once") {
        return { block: true, reason: "User denied" };
      }
    }
```

- [ ] **Step 10: Run the full safe-bash suite + typecheck**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test safe-bash/ && npx tsc --noEmit`
Expected: all PASS, typecheck clean.

- [ ] **Step 11: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/safe-bash/ && git commit -m "feat(safe-bash): add editable Allow-always grant shared via settings allowlist"
```

---

## Task 3: task — subagent JSONL logger

A harness-style append-only log mirroring `model-router/logger.ts`.

**Files:**

- Create: `extensions/task/logger.ts`
- Test: `extensions/task/logger.test.ts`

**Interfaces:**

- Produces: `SubagentStatus = "spawned" | "asked" | "answered" | "completed" | "aborted" | "timeout"`.
- Produces: `interface SubagentEvent { ts: string; parentSession: string; childSession: string; model: string; tokens: number; status: SubagentStatus; durationMs: number }`.
- Produces: `appendSubagentLog(logPath: string, entry: SubagentEvent): void`.

- [ ] **Step 1: Write the failing test**

Create `extensions/task/logger.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSubagentLog } from "./logger.ts";

test("appends one JSON line per event", () => {
  const path = join(mkdtempSync(join(tmpdir(), "subagent-")), "subagent.jsonl");
  appendSubagentLog(path, {
    ts: "2026-06-21T00:00:00.000Z",
    parentSession: "p1",
    childSession: "c1",
    model: "haiku",
    tokens: 1234,
    status: "completed",
    durationMs: 4200,
  });
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).status).toBe("completed");
  expect(JSON.parse(lines[0]).tokens).toBe(1234);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/logger.test.ts`
Expected: FAIL - `Cannot find module './logger.ts'`.

- [ ] **Step 3: Implement the logger**

Create `extensions/task/logger.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SubagentStatus =
  | "spawned"
  | "asked"
  | "answered"
  | "completed"
  | "aborted"
  | "timeout";

export interface SubagentEvent {
  ts: string;
  parentSession: string;
  childSession: string;
  model: string;
  tokens: number;
  status: SubagentStatus;
  durationMs: number;
}

export function appendSubagentLog(logPath: string, entry: SubagentEvent): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/logger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/task/logger.ts extensions/task/logger.test.ts && git commit -m "feat(task): add subagent jsonl logger"
```

---

## Task 4: task — registry, deferred, helpers

The shared in-process state plus three small pure helpers.

**Files:**

- Create: `extensions/task/registry.ts`
- Test: `extensions/task/registry.test.ts`

**Interfaces:**

- Consumes: `AgentSession` type from `@earendil-works/pi-coding-agent`.
- Produces: `deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }`.
- Produces: `interface ChildEntry { session: AgentSession; resolveAsk?: (answer: string) => void; questionSignal: ReturnType<typeof deferred<{ question: string }>>; tokensTotal: number; status: SubagentStatus; startedAt: number }`.
- Produces: `const registry: Map<string, ChildEntry>` (module singleton, shared across sessions in-process).
- Produces: `formatTokens(n: number): string` - compact human form (`1234` → `"1.2k"`, `900` → `"900"`).
- Produces: `augmentTools(tools: string[] | undefined): string[] | undefined` - if an allowlist is given, ensure `"ask-caller"` and `"task"` are in it; otherwise return `undefined` (keep defaults).

- [ ] **Step 1: Write the failing test**

Create `extensions/task/registry.test.ts`:

```ts
import { expect, test } from "bun:test";
import { augmentTools, deferred, formatTokens } from "./registry.ts";

test("deferred resolves with the supplied value", async () => {
  const d = deferred<string>();
  queueMicrotask(() => d.resolve("hi"));
  expect(await d.promise).toBe("hi");
});

test("formatTokens uses a compact k form above 1000", () => {
  expect(formatTokens(900)).toBe("900");
  expect(formatTokens(1234)).toBe("1.2k");
  expect(formatTokens(15564)).toBe("15.6k");
});

test("augmentTools keeps defaults when no allowlist", () => {
  expect(augmentTools(undefined)).toBeUndefined();
});

test("augmentTools injects ask-caller and task into an allowlist", () => {
  expect(augmentTools(["read"]).sort()).toEqual(["ask-caller", "read", "task"]);
});

test("augmentTools does not duplicate existing entries", () => {
  expect(augmentTools(["ask-caller", "task"]).sort()).toEqual([
    "ask-caller",
    "task",
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/registry.test.ts`
Expected: FAIL - `Cannot find module './registry.ts'`.

- [ ] **Step 3: Implement the registry module**

Create `extensions/task/registry.ts`:

```ts
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubagentStatus } from "./logger.ts";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface ChildEntry {
  session: AgentSession;
  resolveAsk?: (answer: string) => void;
  questionSignal: Deferred<{ question: string }>;
  tokensTotal: number;
  status: SubagentStatus;
  startedAt: number;
}

// Shared across the parent and every child: createAgentSession runs in the
// same Node process, so this module-level map is a single instance.
export const registry = new Map<string, ChildEntry>();

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

// Ensure a subagent can always ask its caller and spawn further subagents,
// even when the caller restricts the child's tools.
export function augmentTools(
  tools: string[] | undefined,
): string[] | undefined {
  if (!tools) return undefined;
  const set = new Set(tools);
  set.add("ask-caller");
  set.add("task");
  return [...set];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/task/registry.ts extensions/task/registry.test.ts && git commit -m "feat(task): add subagent registry, deferred, and tool helpers"
```

---

## Task 5: task — rewrite index.ts (spawn, race, ask-caller, resume, timeout, tokens, UI forwarding)

Assemble the continuation engine. This logic depends on a live model session, so it is verified by the smoke test in Task 6 rather than unit tests; the pure helpers it uses are already covered by Tasks 3-4. Keep the existing `tierModelId`/`resolveTierModel`/`lastAssistantText` exports and their tests intact.

**Files:**

- Modify: `extensions/task/index.ts` (full rewrite of the default export; keep the three helper functions and their existing test file `index.test.ts`)

**Interfaces:**

- Consumes: `appendSubagentLog`, `SubagentEvent` (Task 3); `registry`, `deferred`, `formatTokens`, `augmentTools`, `ChildEntry` (Task 4); `tierModelId`/`resolveTierModel`/`lastAssistantText` (existing).
- Consumes (SDK): `createAgentSession`, `DefaultResourceLoader`, `ExtensionAPI`, `ModelRegistry`, `AgentSession`.
- Produces: a `task` tool with params `{ prompt?, model_tier?, tools?, timeout_ms?, resume?, answer? }` and an `ask-caller` customTool injected into each child.

- [ ] **Step 1: Rewrite the default export**

Replace the `export default function (pi: ExtensionAPI) { ... }` block in `extensions/task/index.ts` with the following. Leave the imports for `existsSync`/`readFileSync`/`homedir`/`join`/`Type` and the `tierModelId`/`resolveTierModel`/`lastAssistantText`/`RegistryModel` definitions above it unchanged; add the new imports.

```ts
import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ExtensionAPI,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { appendSubagentLog } from "./logger.ts";
import {
  augmentTools,
  type ChildEntry,
  deferred,
  formatTokens,
  registry,
} from "./registry.ts";
```

```ts
const SUBAGENT_APPEND_PROMPT = [
  "You are a subagent working for a calling agent.",
  "If you need information or a decision you cannot determine yourself, call the `ask-caller` tool with a single clear question; its result is the caller's answer.",
];

const LOG_PATH = join(homedir(), ".pi", "subagent.jsonl");

function readChildTokens(session: AgentSession): number {
  try {
    return session.getSessionStats().tokens.total;
  } catch {
    return 0;
  }
}

function logEvent(
  entry: ChildEntry,
  parentSession: string,
  childSession: string,
  model: string,
  status: ChildEntry["status"],
): void {
  appendSubagentLog(LOG_PATH, {
    ts: new Date().toISOString(),
    parentSession,
    childSession,
    model,
    tokens: entry.tokensTotal,
    status,
    durationMs: Date.now() - entry.startedAt,
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "task",
    label: "Task (subagent)",
    description:
      "Delegate a self-contained task to a subagent with its own context window. " +
      "Provide `prompt` to spawn a subagent; set `timeout_ms` to bound each run segment. " +
      "If the result has status 'awaiting_answer', the subagent asked a question: answer it " +
      "by calling task again with `resume` set to the returned id and `answer` set to your reply, " +
      "or escalate by calling `ask-caller` yourself. Issue multiple task calls in one turn to run subagents in parallel.",
    promptSnippet: "Delegate self-contained work to an isolated subagent",
    executionMode: "parallel",
    parameters: Type.Object({
      prompt: Type.Optional(
        Type.String({
          description:
            "Complete, standalone instructions for a new subagent. Omit when resuming.",
        }),
      ),
      model_tier: Type.Optional(
        Type.Union(
          [Type.Literal("light"), Type.Literal("medium"), Type.Literal("heavy")],
          { description: "Model tier. Omit to inherit the default model." },
        ),
      ),
      tools: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Allowlist of tool names for the subagent. `ask-caller` and `task` are always added.",
        }),
      ),
      timeout_ms: Type.Optional(
        Type.Number({
          description:
            "Abort a run segment that takes longer than this many milliseconds.",
        }),
      ),
      resume: Type.Optional(
        Type.String({
          description:
            "A subagent id from a prior 'awaiting_answer' result, to deliver an answer.",
        }),
      ),
      answer: Type.Optional(
        Type.String({ description: "The answer to feed a resumed subagent." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const parentSession = ctx.sessionManager.getSessionId();

      // --- Resume path -------------------------------------------------
      if (params.resume) {
        const entry = registry.get(params.resume);
        if (!entry || !entry.resolveAsk) {
          return {
            content: [
              { type: "text" as const, text: `No subagent awaiting an answer for id ${params.resume}.` },
            ],
            details: { status: "error" },
          };
        }
        logEvent(entry, parentSession, params.resume, "", "answered");
        const resolve = entry.resolveAsk;
        entry.resolveAsk = undefined;
        entry.questionSignal = deferred<{ question: string }>();
        entry.status = "running";
        resolve(params.answer ?? "");
        return runSegment(entry, params.resume, parentSession, ctx, params.timeout_ms);
      }

      // --- Fresh spawn -------------------------------------------------
      if (!params.prompt) {
        return {
          content: [{ type: "text" as const, text: "Provide `prompt` to spawn a subagent or `resume` to answer one." }],
          details: { status: "error" },
        };
      }

      const model = resolveTierModel(params.model_tier, ctx.modelRegistry);
      const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        agentDir: join(homedir(), ".pi", "agent"),
        systemPrompt: ctx.getSystemPrompt(),
        appendSystemPrompt: SUBAGENT_APPEND_PROMPT,
      });
      await loader.reload();

      const askCaller = {
        name: "ask-caller",
        label: "Ask caller",
        description:
          "Ask your calling agent a question and wait for the answer. Use only when you cannot proceed without input.",
        parameters: Type.Object({
          question: Type.String({ description: "A single, self-contained question." }),
        }),
        async execute(
          _id: string,
          p: { question: string },
          _sig: AbortSignal | undefined,
          _upd: unknown,
          childCtx: { sessionManager: { getSessionId(): string } },
        ) {
          const myId = childCtx.sessionManager.getSessionId();
          const entry = registry.get(myId);
          if (!entry) {
            return {
              content: [{ type: "text" as const, text: "No caller is available to answer." }],
              details: {},
            };
          }
          return new Promise((resolve) => {
            entry.resolveAsk = (answer: string) =>
              resolve({ content: [{ type: "text" as const, text: answer }], details: {} });
            entry.questionSignal.resolve({ question: p.question });
          });
        },
      };

      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        modelRegistry: ctx.modelRegistry,
        resourceLoader: loader,
        customTools: [askCaller],
        ...(model ? { model } : {}),
        ...(augmentTools(params.tools) ? { tools: augmentTools(params.tools) } : {}),
      });

      // Route the child's permission prompts up to the human via the parent UI.
      session.extensionRunner.setUIContext(ctx.ui, ctx.mode);

      const childId = session.sessionId;
      const entry: ChildEntry = {
        session,
        questionSignal: deferred<{ question: string }>(),
        tokensTotal: 0,
        status: "running",
        startedAt: Date.now(),
      };
      registry.set(childId, entry);
      logEvent(entry, parentSession, childId, model?.id ?? "default", "spawned");

      const onAbort = () => void session.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      // Kick off the run; runSegment races it against question/timeout.
      entry.runPromise = session.prompt(params.prompt);
      try {
        return await runSegment(entry, childId, parentSession, ctx, params.timeout_ms);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
```

- [ ] **Step 2: Add the `runSegment` helper and `runPromise` field**

`runSegment` races the in-flight `prompt()` against the child's question signal and an optional timeout, and is reused by both spawn and resume. Add the field to `ChildEntry` in `registry.ts`:

```ts
export interface ChildEntry {
  session: AgentSession;
  runPromise?: Promise<void>;
  resolveAsk?: (answer: string) => void;
  questionSignal: Deferred<{ question: string }>;
  tokensTotal: number;
  status: SubagentStatus;
  startedAt: number;
}
```

Add `runSegment` in `extensions/task/index.ts` (module scope, above the default export):

```ts
type ToolResult = { content: { type: "text"; text: string }[]; details: unknown };

async function runSegment(
  entry: ChildEntry,
  childId: string,
  parentSession: string,
  ctx: { ui: { setStatus(key: string, text: string | undefined): void }; model: { id?: string } | undefined },
  timeoutMs: number | undefined,
): Promise<ToolResult> {
  const modelId = (ctx.model as { id?: string } | undefined)?.id ?? "default";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    if (timeoutMs && timeoutMs > 0) timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const completed = (entry.runPromise ?? Promise.resolve()).then(() => "completed" as const);
  const asked = entry.questionSignal.promise.then((q) => ({ question: q.question }));

  const outcome = await Promise.race([completed, asked, timeout]);
  if (timer) clearTimeout(timer);

  entry.tokensTotal = readChildTokens(entry.session);
  ctx.ui.setStatus(
    "subagents",
    `subagent ${childId.slice(0, 8)}: ${formatTokens(entry.tokensTotal)} tok`,
  );

  if (outcome === "timeout") {
    entry.status = "timeout";
    logEvent(entry, parentSession, childId, modelId, "timeout");
    await entry.session.abort();
    entry.session.dispose();
    registry.delete(childId);
    return {
      content: [{ type: "text", text: `Subagent timed out after ${timeoutMs}ms.` }],
      details: { status: "timeout", tokens: entry.tokensTotal },
    };
  }

  if (outcome === "completed") {
    entry.status = "completed";
    logEvent(entry, parentSession, childId, modelId, "completed");
    const text = lastAssistantText(entry.session.messages);
    entry.session.dispose();
    registry.delete(childId);
    ctx.ui.setStatus("subagents", undefined);
    return {
      content: [{ type: "text", text: text || "(subagent returned no text output)" }],
      details: { status: "completed", tokens: entry.tokensTotal },
    };
  }

  // outcome is the asked question
  entry.status = "awaiting_answer" as ChildEntry["status"];
  logEvent(entry, parentSession, childId, modelId, "asked");
  return {
    content: [
      { type: "text", text: `Subagent ${childId} asks: ${(outcome as { question: string }).question}` },
    ],
    details: { status: "awaiting_answer", resume: childId, question: (outcome as { question: string }).question, tokens: entry.tokensTotal },
  };
}
```

Note: `runSegment` consumes only the slice of `ctx` it needs (`ui`, `model`); the full `ExtensionContext` from `execute` satisfies this shape. `"awaiting_answer"` is a transient runtime status not in `SubagentStatus`; it is only placed on `entry.status` and never logged, so it is cast at the assignment.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && npx tsc --noEmit`
Expected: clean. Fix any type mismatch (most likely: narrow the `ctx` shape in `runSegment`, or adjust the `ToolResult` cast) before proceeding.

- [ ] **Step 4: Run the existing unit tests**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern/extensions && bun test task/`
Expected: `index.test.ts` (lastAssistantText), `logger.test.ts`, `registry.test.ts` all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/task/index.ts extensions/task/registry.ts && git commit -m "feat(task): subagent ask/resume, timeout, token accounting, UI forwarding"
```

---

## Task 6: end-to-end smoke test

The continuation engine needs a live model. Verify it against real Pi in non-interactive mode. AWS Bedrock credentials must be active (the repo owner activates them via their `~/code/c-moia/.envrc` profile: `AWS_REGION=eu-central-1`, `AWS_PROFILE=ai-coding.tools/vehicle-perception-engineer`).

**Files:**

- Create: `extensions/task/SMOKE.md` (documents the manual checks and expected results)

**Interfaces:**

- Consumes: the built `task` extension via the `~/.pi/agent/extensions` symlink (already installed).

- [ ] **Step 1: Confirm credentials are active**

Run: `AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" aws sts get-caller-identity --no-cli-pager`
Expected: a JSON identity. If it errors, the owner must refresh SSO first.

- [ ] **Step 2: Smoke — basic delegation**

Run:

```bash
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 90 pi -p --no-session --tools task \
"Use the task tool to delegate this prompt: 'Reply with only: SMOKE_OK'. Report what came back." 2>&1
```

Expected: output contains `SMOKE_OK`, exit 0.

- [ ] **Step 3: Smoke — ask / resume round trip**

Run:

```bash
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 120 pi -p --no-session --tools task \
"Delegate via the task tool: 'You do not know the deploy target. Call ask-caller to ask: which environment? Then reply with only that environment name.' When the subagent asks, the target is 'staging' — answer it by calling task again with resume set to the returned id and answer 'staging'." 2>&1
```

Expected: the model receives an `awaiting_answer` result, resumes with `staging`, and the final output contains `staging`. Confirm `~/.pi/subagent.jsonl` has `spawned`, `asked`, `answered`, `completed` lines for one child id.

- [ ] **Step 4: Smoke — timeout guard**

Run:

```bash
AWS_REGION=eu-central-1 AWS_PROFILE="ai-coding.tools/vehicle-perception-engineer" \
timeout 60 pi -p --no-session --tools task \
"Use the task tool with timeout_ms set to 1 to delegate: 'Write a 500 word essay about distributed systems.' Report the status you get back." 2>&1
```

Expected: the tool returns a `timeout` status (the 1ms budget expires before the child finishes); `~/.pi/subagent.jsonl` has a `timeout` line. Exit 0 (the parent run itself completes).

- [ ] **Step 5: Record results**

Create `extensions/task/SMOKE.md` capturing the three commands above and their observed output (paste the relevant lines), plus the `subagent.jsonl` excerpts. This is the standing record that the live path works.

- [ ] **Step 6: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add extensions/task/SMOKE.md && git commit -m "test(task): document end-to-end subagent ask/resume/timeout smoke checks"
```

---

## Task 7: docs & backlog sync

**Files:**

- Modify: `README.md` (task row), `TODO.md` (move items to Done)

- [ ] **Step 1: Update the README task row**

In `README.md`, replace the `task` table row with:

```text
| `task` | Subagent delegation with `ask-caller` escalation to the caller, permission prompts routed to the human, parent-set `timeout_ms`, inherited system prompt, and token accounting logged to `~/.pi/subagent.jsonl` |
```

- [ ] **Step 2: Move completed backlog items**

In `TODO.md`, move "`task`: live smoke test" and "`task`: stream child progress" notes into a Done section reflecting what shipped (ask/resume, timeout, tokens, UI forwarding, smoke tests), and add a one-line note that depth limits were deliberately deferred.

- [ ] **Step 3: Lint the markdown**

Run: `cd /Users/tillhoffmann/code/thetillhoff/kern && npx markdownlint-cli --disable MD013 -- README.md TODO.md`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/kern && git add README.md TODO.md && git commit -m "docs: record subagent escalation feature, sync backlog"
```

---

## Self-Review

**Spec coverage:**

- Ask → parent LLM: Task 5 (`ask-caller` customTool + `runSegment` question path + resume path). ✓
- Permission → human via UI chain: Task 5 (`setUIContext(ctx.ui, ctx.mode)`). ✓
- Shared persisted grant / Allow-always: Task 2. ✓
- Token summing into UI: Task 5 (`runSegment` reads `getSessionStats`, `setStatus`) + Task 4 (`formatTokens`). ✓
- System prompt + skills inheritance: Task 5 (`DefaultResourceLoader` with `systemPrompt` + `appendSystemPrompt`; skills load from disk). ✓
- Parent-set timeout: Task 5 (`timeout_ms` param, `runSegment` race), paused across resume because the timer is per-segment and re-created only when `runSegment` runs (it does not run while `awaiting_answer`). ✓
- Subagent logging (jsonl, harness style): Task 3 + Task 5 wiring. ✓
- One-line live status: Task 5 (`setStatus`). ✓
- model-router fixes: Task 1. ✓
- Depth limit: explicitly deferred (noted in Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only judgement step is Task 5 Step 3 (resolve any type mismatch), which is expected for an assembly task and bounded to the named likely fixes.

**Type consistency:** `ChildEntry` is defined in Task 4 and extended once in Task 5 Step 2 (adds `runPromise`); `SubagentStatus`/`SubagentEvent` from Task 3 are used unchanged; `augmentTools`/`formatTokens`/`deferred`/`registry` names match between Tasks 4 and 5; `appendSubagentLog` signature matches between Tasks 3 and 5.

**Known risk:** `runSegment`'s `ctx` shape is a structural subset of `ExtensionContext`; if `tsc` rejects the narrowing, widen the param to `ExtensionContext` and import the type. The `"awaiting_answer"` runtime status is intentionally outside `SubagentStatus` (never logged).
