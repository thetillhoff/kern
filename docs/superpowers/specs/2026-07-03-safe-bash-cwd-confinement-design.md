# safe-bash base-confinement design

## Problem

Scoped allowlist entries of the form `<cmd> <base>/*` (e.g. `cat ./*`,
`find ~/code/*`) were meant to confine a read-only command to a directory
subtree. They are implemented as a naive glob (`^cat \./.*$`), which is both
**leaky** and **unsafe**:

- **Nuisance prompts:** a bare relative name (`cat README.md`) or a flag before
  the path (`cat -n README.md`, `ls -la ./x`) does not start with `./`, so it
  fails the glob and re-prompts every time.
- **Confinement bypass (security):** `cat ./../../../etc/passwd` starts with
  `cat ./`, so it *matches* `cat ./*` and is auto-approved — reading a file far
  outside cwd. Confirmed against the shipped code.

## Goal

Redefine `<cmd> <base>/*` to mean "this command, with any arguments, confined to
the `<base>` directory subtree". An invocation is auto-approved iff every
path argument resolves to a location within `<base>`. Anything escaping it
(a path outside the subtree, or a `.`/`..` trick that collapses to an escape)
prompts as before.

Supported bases (all handled by one mechanism):

- `.` — the current working directory (`cat ./*`)
- `~` / `~/sub` — the home directory or a subtree of it (`find ~/code/*`)
- `/abs/dir` — an absolute subtree (`tail /var/log/*`)

## Decisions

- **Lexical resolver, not filesystem.** Resolve paths with Node's `path.posix`
  (`join` + `normalize`) against the known `cwd` and `home` anchors — pure
  string math, no disk access, no symlink resolution, works on paths that don't
  exist yet. This mirrors Go's `path.Clean` (lexical) vs `filepath.EvalSymlinks`
  (filesystem) split; Go defaults to lexical. Accepted gap: a symlink *inside*
  the base pointing outside is not caught. Documented, upgradeable later.
- **Resolve-then-contain, not pure-lexical.** The `./*`-only design could check
  "no arg escapes cwd" lexically without any anchor. Generalizing to `~/` and
  `/` bases requires resolving each arg to an absolute path and testing subtree
  containment, so `cwd`/`home` are threaded into the check.
- **Decision-only, no execution rewrite.** The *new resolver* only decides
  allow-vs-prompt; it does not touch the command string. (`normalizePaths` still
  rewrites `input.command` as it does today — see Wiring; that is pre-existing
  and unchanged.) Adding a second rewrite would collapse `//` and mangle non-path
  args (`curl https://x` → `https:/x`) for no security gain — a confined path is
  correct as-typed, an escaping one prompts regardless.
- **Marker: reuse `<cmd> <base>/*`.** No new config field. Existing `cat ./*` /
  `find ~/code/*` entries start working correctly on upgrade. Only `*/`-tailed
  (trailing `/*`) entries become confined; plain globs (`grep *`) and the
  trailing `*` behavior are untouched. Trade-off accepted: a trailing `/*` no
  longer reads as a literal glob — documented in code.
- **Confinement is allowlist-only.** Blocklist entries keep plain-glob
  semantics.
- **Root base unsupported.** Confining to `/` means confining to everything —
  degenerate. A base is rejected (falls back to plain glob) when it is empty
  after stripping the trailing `/*` **or** when `resolveAbs(base)` is `/`. The
  latter guard catches `//*`, `/*/`, and any base that normalizes to root; an
  empty-string check alone does not.

## Components (`extensions/safe-bash/rules.ts`)

### Confined-pattern parse

A pattern is confined iff it ends with `/*` and the base is non-empty.

- `base = <last whitespace token, with trailing "/*" removed>`
- `prefix = <everything before the last token>`

Examples: `cat ./*` → prefix `cat`, base `.`; `find ~/code/*` → prefix `find`,
base `~/code`; `git log ./*` → prefix `git log`, base `.`;
`tail /var/log/*` → prefix `tail`, base `/var/log`.

Parse is whitespace-naive: the base is the last whitespace-delimited token, so a
base containing spaces (`tail "/var/my logs"/*`) is not supported. Such patterns
are exotic in an allowlist; accepted limitation, noted in code.

### `resolveAbs(token, cwd, home): string`

Pure. Canonical absolute form of a path token:

1. If it starts with `~`, replace the leading `~` with `home`.
2. If the result is `path.posix.isAbsolute`, keep it; else `path.posix.join(cwd, result)`.
3. Return `path.posix.normalize(...)`.

### `withinBase(command, prefix, base, cwd, home): boolean`

Pure. The confined match test:

- Command must equal `prefix` (bare, e.g. stdin use) **or** start with
  `prefix + " "`.
- `absBase = resolveAbs(base, cwd, home)`.
- For each argument token after `prefix`, in this order (order matters — see
  below):
  1. **Strip all quote characters** (`"` and `'`) from the token. Paths never
     legitimately contain them, and stripping *all* of them — not just a matched
     surrounding pair — defeats quote-concatenation escapes like
     `".."/../etc/passwd` that a surrounding-pair strip leaves intact.
  2. **Split on `=`** into parts (this must happen *before* the flag check, so a
     `--file=/etc/passwd` value is not swallowed by the flag skip). Test each
     part independently.
  3. For each part starting with `-`:
     - **contains no `/`** → pure flag, skip it.
     - **contains `/`** (glued path forms like `-I/etc`, `grep -f/etc/shadow`) →
       **return false immediately (prompt)**. Do *not* run it through
       `resolveAbs`. The shell's real path is the substring after the flag
       letters (`/etc/shadow`), but `resolveAbs` only tests `isAbsolute` on the
       *whole* token — `-f/etc/shadow` is not absolute, so it would be joined to
       `cwd` as `<cwd>/-f/etc/shadow`, test as *contained*, and auto-approve a
       read of `/etc/shadow`. Bailing to a prompt is the only sound answer:
       glued short flags carry no `=` to split on, so the token→path mapping
       cannot be recovered lexically.
  4. Non-flag part: `absArg = resolveAbs(part, cwd, home)`; contained iff
     `absArg === absBase || absArg.startsWith(absBase + "/")`.
- Returns true iff the prefix matches and no argument falls outside `absBase`.

The strip-then-split-then-flag-check order is load-bearing: skipping `-` tokens
first (as an earlier draft did) would drop `--file=/etc/passwd` before it could
be split, re-opening the very bypass this design closes. Equally load-bearing:
a `-`-token containing `/` must bail to a prompt directly, **not** be handed to
`resolveAbs` — a relative-looking token (`-f/etc/shadow`) joins *under* `cwd`
and would falsely test as contained.

### Dispatch: `matchesAllowlistEntry(command, pattern, cwd, home): boolean`

Used by `index.ts` for allowlist checks:

- Confined pattern → `withinBase(...)`.
- Otherwise → existing `matchesPattern(command, pattern)` (pure glob, including
  the trailing `*` rule). Blocklist keeps calling `matchesPattern` directly.

## Wiring (`extensions/safe-bash/index.ts`)

`normalizePaths` still runs first, so cwd-absolute and `~/`/`$HOME` paths are
rewritten to `./…` / `~/…` before matching. The allowlist check switches from
`matchesPattern(seg, p)` to `matchesAllowlistEntry(seg, p, cwd, home)`; `cwd`
and `home` are already computed in the extension.

## Behavior

| entry | command | result |
| --- | --- | --- |
| `cat ./*` | `cat README.md`, `cat -n README.md`, `cat ./src/x`, `cat` (stdin) | allow |
| `cat ./*` | `cat ./sub/../file` (collapses to `file`, in cwd) | allow |
| `cat ./*` | `cat /etc/passwd`, `cat ./../../etc/passwd`, `cat ../x` | prompt |
| `cat ./*` | `cat --file=/etc/passwd`, `cat "../../etc/passwd"` | prompt |
| `find ~/code/*` | `find ~/code/foo -name x` | allow |
| `find ~/code/*` | `find /etc …`, `find ~/../../etc` | prompt |
| `tail /var/log/*` | `tail /var/log/syslog` | allow |
| `tail /var/log/*` | `tail /etc/x`, `tail ./x` (cwd not under /var/log) | prompt |
| `ls ./*` | `lsof …`, `npm …` (prefix mismatch) | prompt |

## Known properties / gaps

- **Over-prompt on non-cwd bases (safe direction).** For a `~/…` or `/…` base,
  bare-relative args and flag values resolve against `cwd`; if `cwd` is not
  under the base they resolve outside it and prompt. Never under-allows — an
  escaping absolute or `..` path is always caught. `.`-based entries are
  unaffected.
- **Symlink inside the base pointing out is not detected** (lexical only) —
  `ponytail:` comment.
- **Glued flag+path forms are handled by failing safe**, not by parsing: any
  `-` token containing `/` bails straight to a prompt (see `withinBase` step 3),
  because its lexical resolution does not match how the shell splits flag from
  path. The only remaining uncovered case is a glued flag whose path value
  contains no `/` (e.g. `-f..`, value `..` — a bare parent ref); it is skipped as
  a pure flag. Rare, points at a directory not a file, safe-ish for read
  commands — `ponytail:` comment.
- **`~user` (other users' homes) mis-resolves** — `resolveAbs` replaces only the
  leading `~`, so `~foo` becomes `<home>foo`, not user `foo`'s home. Resolves
  outside the base → prompts (safe direction). `ponytail:` comment.
- **Quote-concatenation escapes are handled** by stripping all quote chars from
  each token before resolving (see `withinBase` step 1).

## Tests (`extensions/safe-bash/rules.test.ts`)

Cover every row of the behavior table, plus:

- confined-pattern parse: `cat ./*`, `find ~/code/*`, `git log ./*`,
  `tail /var/log/*`, and non-confined (`grep *`, `find ~/code/x` without `/*`)
- `resolveAbs`: `~/x` → home, `/abs` → itself, `x`/`./x` → cwd-joined,
  `./a/../b` collapse
- quote-stripped escape (`cat "../../etc/passwd"` → prompt)
- quote-concatenation escape (`cat ".."/../etc/passwd` → prompt) — guards the
  strip-all-quotes rule
- `=`-split escape (`cat --file=/etc/passwd` → prompt) — guards the
  split-before-flag-skip ordering; must fail if the skip runs first
- glued flag+path escape (`grep -f/etc/shadow` with `grep ./*` → prompt) —
  guards the "`-` token containing `/` bails to a prompt, is not run through
  `resolveAbs`" rule; must fail if the token is instead cwd-joined (it would
  then falsely test as contained and allow)
- flag skipped (`cat -n README.md` → allow)
- prefix mismatch (`lsof` vs `ls ./*`, `npm` vs `cat ./*`)
- multi-word prefix (`git log ./x` matches `git log ./*`, `git log /abs` prompts)
- integration: `normalizePaths` then match for a cwd-absolute and a home path
- no interaction with the trailing `*` rule (`ls *` still matches bare `ls`)
- root base not treated as confined: bare `/*`, and `//*` (base resolves to `/`)
