# safe-bash base-confinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<cmd> <base>/*` allowlist entries confine a command to the `<base>` directory subtree (cwd `.`, home `~/…`, or absolute `/…`), closing the `./../..` bypass and the bare-relative-name nuisance prompts.

**Architecture:** Add pure, lexical helpers to `extensions/safe-bash/rules.ts` — `resolveAbs` (token → canonical absolute path via `path.posix`), `parseConfined` (pattern → `{prefix, base}` or null), `withinBase` (confined match test), and `matchesAllowlistEntry` (dispatch: confined → `withinBase`, else existing `matchesPattern`). Wire the allowlist check in `index.ts` to `matchesAllowlistEntry`. No filesystem access, no execution rewrite.

**Tech Stack:** Bun + TypeScript. Tests colocated as `*.test.ts`, run with `bun test`. Verify with `bunx tsc --noEmit` and `bunx biome check`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-03-safe-bash-cwd-confinement-design.md` — the authority; re-read the `withinBase` step ordering before Task 3.
- No Python. All commands are Bun/TypeScript.
- Formatting: repo uses **tabs** for indentation (biome-enforced). Match it.
- Lexical only: use `node:path` `posix` (`isAbsolute`, `join`, `normalize`). No `fs`, no `realpath`, no symlink resolution.
- All git commands use `cd ~/code/thetillhoff/kern && git …` (never `git -C`).
- `matchesPattern` (plain glob, incl. trailing `*`) stays unchanged and remains the blocklist matcher. Confinement is allowlist-only.
- Run from `extensions/`: `cd ~/code/thetillhoff/kern/extensions`.

---

### Task 1: `resolveAbs` — lexical path resolver

**Files:**

- Modify: `extensions/safe-bash/rules.ts` (add import + function)
- Test: `extensions/safe-bash/rules.test.ts`

**Interfaces:**

- Consumes: `node:path` `posix`.
- Produces: `resolveAbs(token: string, cwd: string, home: string): string` — canonical absolute POSIX path. `~`-prefix expands against `home` (leading `~` only, so `~foo` → `<home>foo`); non-absolute results join against `cwd`; `.`/`..` collapse via `normalize`.

- [ ] **Step 1: Write the failing test**

Add to `extensions/safe-bash/rules.test.ts` (add `resolveAbs` to the existing import from `./rules.ts`):

```ts
import { resolveAbs } from "./rules.ts";

const CWD = "/Users/me/code/proj";
const HOME = "/Users/me";

test("resolveAbs: absolute path is normalized, not joined", () => {
 expect(resolveAbs("/etc/passwd", CWD, HOME)).toBe("/etc/passwd");
 expect(resolveAbs("/var/./log/../log", CWD, HOME)).toBe("/var/log");
});

test("resolveAbs: ~ expands against home", () => {
 expect(resolveAbs("~/code/x", CWD, HOME)).toBe("/Users/me/code/x");
 expect(resolveAbs("~", CWD, HOME)).toBe("/Users/me");
});

test("resolveAbs: relative and ./ join against cwd, .. collapses", () => {
 expect(resolveAbs("README.md", CWD, HOME)).toBe("/Users/me/code/proj/README.md");
 expect(resolveAbs("./sub/../file", CWD, HOME)).toBe("/Users/me/code/proj/file");
 expect(resolveAbs("../x", CWD, HOME)).toBe("/Users/me/code/x");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "resolveAbs"`
Expected: FAIL — `resolveAbs` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

At the top of `extensions/safe-bash/rules.ts`, add the import:

```ts
import { posix as path } from "node:path";
```

Add the function (place it above `matchesPattern`):

```ts
/**
 * Resolve a shell path token to a canonical absolute POSIX path, lexically —
 * no filesystem access, no symlink resolution. A leading `~` expands against
 * `home` (only the leading char, so `~foo` becomes `<home>foo`); a non-absolute
 * result joins against `cwd`; `normalize` collapses `.`/`..` segments.
 */
export function resolveAbs(token: string, cwd: string, home: string): string {
 let t = token.startsWith("~") ? home + token.slice(1) : token;
 if (!path.isAbsolute(t)) t = path.join(cwd, t);
 return path.normalize(t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "resolveAbs"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/thetillhoff/kern && git add extensions/safe-bash/rules.ts extensions/safe-bash/rules.test.ts && git commit -m "feat(safe-bash): add lexical resolveAbs path resolver"
```

---

### Task 2: `parseConfined` — recognize `<cmd> <base>/*` entries

**Files:**

- Modify: `extensions/safe-bash/rules.ts`
- Test: `extensions/safe-bash/rules.test.ts`

**Interfaces:**

- Consumes: `resolveAbs` (Task 1).
- Produces: `parseConfined(pattern: string, cwd: string, home: string): { prefix: string; base: string } | null` — non-null only for a confined entry: ends with `/*`, has a space before the base, base non-empty after dropping `/*`, and `resolveAbs(base)` is not `/`.

- [ ] **Step 1: Write the failing test**

Add to `extensions/safe-bash/rules.test.ts` (add `parseConfined` to the import):

```ts
test("parseConfined: splits prefix and base off a trailing /*", () => {
 expect(parseConfined("cat ./*", CWD, HOME)).toEqual({ prefix: "cat", base: "." });
 expect(parseConfined("find ~/code/*", CWD, HOME)).toEqual({ prefix: "find", base: "~/code" });
 expect(parseConfined("git log ./*", CWD, HOME)).toEqual({ prefix: "git log", base: "." });
 expect(parseConfined("tail /var/log/*", CWD, HOME)).toEqual({ prefix: "tail", base: "/var/log" });
});

test("parseConfined: null for non-confined patterns", () => {
 expect(parseConfined("grep *", CWD, HOME)).toBeNull(); // trailing ' *', not '/*'
 expect(parseConfined("find ~/code/x", CWD, HOME)).toBeNull(); // no trailing /*
 expect(parseConfined("cat", CWD, HOME)).toBeNull(); // no /* and no space
});

test("parseConfined: null for root/degenerate bases", () => {
 expect(parseConfined("/*", CWD, HOME)).toBeNull(); // no command before base
 expect(parseConfined("cat /*", CWD, HOME)).toBeNull(); // base empty after dropping /*
 expect(parseConfined("cat //*", CWD, HOME)).toBeNull(); // base '/' resolves to root
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "parseConfined"`
Expected: FAIL — `parseConfined` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `extensions/safe-bash/rules.ts` (below `resolveAbs`):

```ts
/**
 * Parse a confined allowlist entry of the shape `<prefix> <base>/*`, meaning
 * "<prefix> with any args, restricted to the <base> directory subtree". Returns
 * `{prefix, base}` or null when the pattern is not confined: no trailing `/*`,
 * no space before the base, an empty base, or a base that resolves to root `/`
 * (confining to everything is degenerate). Parse is whitespace-naive — the base
 * is the last whitespace-delimited token, so a base containing spaces is
 * unsupported (exotic in an allowlist).
 */
export function parseConfined(
 pattern: string,
 cwd: string,
 home: string,
): { prefix: string; base: string } | null {
 if (!pattern.endsWith("/*")) return null;
 const lastSpace = pattern.lastIndexOf(" ");
 if (lastSpace < 0) return null; // need a command before the base
 const base = pattern.slice(lastSpace + 1, -2); // drop trailing "/*"
 if (base === "") return null; // bare "/*" — root, degenerate
 if (resolveAbs(base, cwd, home) === "/") return null; // resolves to root
 return { prefix: pattern.slice(0, lastSpace), base };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "parseConfined"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/thetillhoff/kern && git add extensions/safe-bash/rules.ts extensions/safe-bash/rules.test.ts && git commit -m "feat(safe-bash): parse confined <cmd> <base>/* allowlist entries"
```

---

### Task 3: `withinBase` — subtree containment match

**Files:**

- Modify: `extensions/safe-bash/rules.ts`
- Test: `extensions/safe-bash/rules.test.ts`

**Interfaces:**

- Consumes: `resolveAbs` (Task 1).
- Produces: `withinBase(command: string, prefix: string, base: string, cwd: string, home: string): boolean` — true iff `command` equals `prefix` or starts with `prefix + " "` **and** every argument stays within `resolveAbs(base)`. Per-token order: strip all quotes → split on `=` → for `-` parts skip if no `/` else return false → non-flag parts must be contained.

**Re-read before implementing:** the `withinBase` section of the spec. The strip→split→flag-check order and the "`-` token with `/` bails to a prompt" rule are load-bearing security properties.

- [ ] **Step 1: Write the failing test**

Add to `extensions/safe-bash/rules.test.ts` (add `withinBase` to the import):

```ts
// cwd is under ~/code, so bare-relative args resolve inside a ~/code base too.
const within = (cmd: string, prefix: string, base: string) =>
 withinBase(cmd, prefix, base, CWD, HOME);

test("withinBase: cwd base allows in-tree, bare names, flags, stdin", () => {
 expect(within("cat README.md", "cat", ".")).toBe(true);
 expect(within("cat -n README.md", "cat", ".")).toBe(true);
 expect(within("cat ./src/x", "cat", ".")).toBe(true);
 expect(within("cat ./sub/../file", "cat", ".")).toBe(true); // collapses in-tree
 expect(within("cat", "cat", ".")).toBe(true); // stdin, no args
});

test("withinBase: cwd base prompts on escapes", () => {
 expect(within("cat /etc/passwd", "cat", ".")).toBe(false);
 expect(within("cat ./../../etc/passwd", "cat", ".")).toBe(false);
 expect(within("cat ../x", "cat", ".")).toBe(false);
});

test("withinBase: prefix must be token-aligned", () => {
 expect(within("lsof foo", "ls", ".")).toBe(false);
 expect(within("npm x", "cat", ".")).toBe(false);
 expect(within("ls", "ls", ".")).toBe(true);
});

test("withinBase: home and absolute bases", () => {
 expect(within("find ~/code/foo -name x", "find", "~/code")).toBe(true);
 expect(within("find /etc -name x", "find", "~/code")).toBe(false);
 expect(within("find ~/../../etc", "find", "~/code")).toBe(false);
 expect(within("tail /var/log/syslog", "tail", "/var/log")).toBe(true);
 expect(within("tail /etc/x", "tail", "/var/log")).toBe(false);
});

test("withinBase: --file= is split before the flag skip", () => {
 expect(within("cat --file=/etc/passwd", "cat", ".")).toBe(false);
});

test("withinBase: all quote chars stripped (concat escape)", () => {
 expect(within('cat "../../etc/passwd"', "cat", ".")).toBe(false);
 expect(within('cat ".."/../etc/passwd', "cat", ".")).toBe(false);
});

test("withinBase: glued flag+path bails to a prompt", () => {
 expect(within("grep -f/etc/shadow", "grep", ".")).toBe(false);
 expect(within("cat -n README.md", "cat", ".")).toBe(true); // pure flag still skipped
});

test("withinBase: multi-word prefix", () => {
 expect(within("git log ./x", "git log", ".")).toBe(true);
 expect(within("git log /abs", "git log", ".")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "withinBase"`
Expected: FAIL — `withinBase` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `extensions/safe-bash/rules.ts` (below `parseConfined`):

```ts
/**
 * Confined match test: true iff `command` is `prefix` (bare, e.g. stdin use) or
 * starts with `prefix + " "`, and every path argument stays within `base`'s
 * subtree. Pure and lexical.
 *
 * Per-argument order is load-bearing (see the design doc):
 *   1. strip ALL quote chars — defeats concat escapes like `".."/../etc`
 *      that a surrounding-pair strip would leave intact.
 *   2. split on `=` BEFORE the flag check — so a `--file=/etc/passwd` value is
 *      not swallowed by the flag skip.
 *   3. a `-` part with no `/` is a pure flag (skip); a `-` part containing `/`
 *      (glued forms like `-f/etc/shadow`) bails to a prompt — its shell path is
 *      the substring after the flag letters, which resolveAbs cannot recover, so
 *      cwd-joining it would falsely test as contained.
 */
export function withinBase(
 command: string,
 prefix: string,
 base: string,
 cwd: string,
 home: string,
): boolean {
 const cmd = command.trim();
 let rest: string;
 if (cmd === prefix) rest = "";
 else if (cmd.startsWith(`${prefix} `)) rest = cmd.slice(prefix.length + 1);
 else return false;

 const absBase = resolveAbs(base, cwd, home);
 for (const token of rest.split(/\s+/).filter(Boolean)) {
  const unquoted = token.replace(/['"]/g, ""); // 1. strip all quotes
  for (const part of unquoted.split("=")) {
   // 2. split before flag check
   if (part === "") continue;
   if (part.startsWith("-")) {
    if (part.includes("/")) return false; // 3. glued flag+path → prompt
    continue; // pure flag
   }
   const abs = resolveAbs(part, cwd, home);
   if (abs !== absBase && !abs.startsWith(`${absBase}/`)) return false;
  }
 }
 return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "withinBase"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/thetillhoff/kern && git add extensions/safe-bash/rules.ts extensions/safe-bash/rules.test.ts && git commit -m "feat(safe-bash): add withinBase subtree containment check"
```

---

### Task 4: `matchesAllowlistEntry` — dispatch confined vs glob

**Files:**

- Modify: `extensions/safe-bash/rules.ts`
- Test: `extensions/safe-bash/rules.test.ts`

**Interfaces:**

- Consumes: `parseConfined` (Task 2), `withinBase` (Task 3), `matchesPattern` (existing).
- Produces: `matchesAllowlistEntry(command: string, pattern: string, cwd: string, home: string): boolean` — confined pattern → `withinBase`; otherwise → `matchesPattern`. This is the allowlist matcher `index.ts` will call.

- [ ] **Step 1: Write the failing test**

Add to `extensions/safe-bash/rules.test.ts` (add `matchesAllowlistEntry` to the import):

```ts
const allow = (cmd: string, pat: string) =>
 matchesAllowlistEntry(cmd, pat, CWD, HOME);

test("matchesAllowlistEntry: confined entries use containment", () => {
 expect(allow("cat README.md", "cat ./*")).toBe(true);
 expect(allow("cat /etc/passwd", "cat ./*")).toBe(false);
 expect(allow("find ~/code/foo", "find ~/code/*")).toBe(true);
});

test("matchesAllowlistEntry: non-confined entries fall back to glob", () => {
 expect(allow("grep -i foo", "grep *")).toBe(true); // trailing ' *' glob
 expect(allow("ls", "ls *")).toBe(true); // trailing ' *' still matches bare
 expect(allow("git status -s", "git status *")).toBe(true);
 expect(allow("rm -rf /", "git status *")).toBe(false);
});

test("matchesAllowlistEntry: bare /* is a glob, not confined", () => {
 // base empty after dropping /* → parseConfined returns null → plain glob
 expect(allow("cat /etc/x", "cat /*")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "matchesAllowlistEntry"`
Expected: FAIL — `matchesAllowlistEntry` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `extensions/safe-bash/rules.ts` (below `withinBase`):

```ts
/**
 * Allowlist match. Confined entries (`<cmd> <base>/*`) are checked by subtree
 * containment; every other pattern falls back to plain glob `matchesPattern`
 * (including the trailing ` *` rule). Use this for allowlist checks only — the
 * blocklist keeps plain-glob semantics via `matchesPattern` directly.
 */
export function matchesAllowlistEntry(
 command: string,
 pattern: string,
 cwd: string,
 home: string,
): boolean {
 const confined = parseConfined(pattern, cwd, home);
 if (confined) return withinBase(command, confined.prefix, confined.base, cwd, home);
 return matchesPattern(command, pattern);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "matchesAllowlistEntry"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/thetillhoff/kern && git add extensions/safe-bash/rules.ts extensions/safe-bash/rules.test.ts && git commit -m "feat(safe-bash): dispatch allowlist matching via matchesAllowlistEntry"
```

---

### Task 5: Wire `index.ts` + integration test + full verification

**Files:**

- Modify: `extensions/safe-bash/index.ts` (import + allowlist check, ~line 7 import block and ~line 77)
- Test: `extensions/safe-bash/rules.test.ts` (integration: `normalizePaths` → `matchesAllowlistEntry`)

**Interfaces:**

- Consumes: `matchesAllowlistEntry` (Task 4), `normalizePaths` (existing).

- [ ] **Step 1: Write the failing integration test**

Add to `extensions/safe-bash/rules.test.ts` (add `normalizePaths` to the import if not already present):

```ts
test("integration: normalizePaths then confined match (cwd-absolute + home)", () => {
 // A cwd-absolute path normalizes to ./… then matches a cwd-confined entry.
 const abs = normalizePaths(`cat ${CWD}/README.md`, HOME, CWD);
 expect(matchesAllowlistEntry(abs, "cat ./*", CWD, HOME)).toBe(true);
 // A home path normalizes to ~/… then matches a home-confined entry.
 const homePath = normalizePaths(`ls ${HOME}/code/x`, HOME, CWD);
 expect(matchesAllowlistEntry(homePath, "ls ~/code/*", CWD, HOME)).toBe(true);
 // An out-of-tree absolute path still prompts.
 expect(matchesAllowlistEntry("cat /etc/passwd", "cat ./*", CWD, HOME)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it passes or reveals the wiring gap**

Run: `cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/rules.test.ts -t "integration"`
Expected: PASS — this test exercises library functions directly, so it passes once Tasks 1–4 are in. It documents the `normalizePaths`→match contract that Step 3 wires into the extension. (If it fails, a prior task's function is wrong — fix before proceeding.)

- [ ] **Step 3: Wire the extension**

In `extensions/safe-bash/index.ts`, add `matchesAllowlistEntry` to the import from `./rules.ts`:

```ts
import {
 isValidPattern,
 matchesAllowlistEntry,
 matchesPattern,
 normalizePaths,
 SUBST_RE,
 splitSegments,
 suggestPattern,
} from "./rules.ts";
```

Then change the allowlist check inside the `for (const seg of toCheck)` loop from:

```ts
  if (
   !SUBST_RE.test(seg) &&
   rules.allowlist.some((p) => matchesPattern(seg, p))
  )
   continue; // pre-approved (or just allow-always'd)
```

to (the blocklist check above still uses `matchesPattern` — leave it):

```ts
  if (
   !SUBST_RE.test(seg) &&
   rules.allowlist.some((p) => matchesAllowlistEntry(seg, p, cwd, home))
  )
   continue; // pre-approved (or just allow-always'd)
```

`cwd` and `home` are already defined at the top of the extension function.

- [ ] **Step 4: Full verification**

Run each and confirm:

```bash
cd ~/code/thetillhoff/kern/extensions && bun test safe-bash/
```

Expected: all tests PASS, 0 fail.

```bash
cd ~/code/thetillhoff/kern/extensions && bunx tsc --noEmit
```

Expected: no errors.

```bash
cd ~/code/thetillhoff/kern/extensions && bunx biome check safe-bash/
```

Expected: no errors (run `bunx biome check --write safe-bash/` to auto-fix formatting, then re-check).

- [ ] **Step 5: Commit**

```bash
cd ~/code/thetillhoff/kern && git add extensions/safe-bash/index.ts extensions/safe-bash/rules.test.ts && git commit -m "feat(safe-bash): confine allowlist entries to their base subtree

<cmd> <base>/* entries now match by subtree containment (cwd, home,
or absolute) instead of a leaky glob, closing the ./../.. bypass and
the bare-relative-name re-prompts."
```

---

### Task 6: CHANGELOG

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the entry**

Add at the top of `CHANGELOG.md`, above `## v0.1.16`:

```markdown
## v0.1.17

- `safe-bash` allowlist entries of the form `<cmd> <base>/*` (e.g. `cat ./*`, `find ~/code/*`, `tail /var/log/*`) now confine the command to the `<base>` directory subtree by resolving each path argument and checking containment, instead of a naive glob. Closes a confinement bypass (`cat ./../../../etc/passwd` matched `cat ./*`) and stops re-prompting on bare relative names (`cat README.md`) and flags before the path (`cat -n README.md`)
```

- [ ] **Step 2: Commit**

```bash
cd ~/code/thetillhoff/kern && git add CHANGELOG.md && git commit -m "chore: update CHANGELOG for v0.1.17"
```

---

## Notes for the implementer

- `ponytail:` comments to leave in `rules.ts` where relevant (from the spec's gaps): symlink-inside-base not detected (lexical only); `~user` other-home mis-resolves (safe direction); glued flag whose path has no `/` (e.g. `-f..`) skipped as a pure flag.
- Do not add a new dependency — `node:path` is built in.
- Do not rewrite the executed command; the resolver is decision-only.
