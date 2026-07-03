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
- **Decision-only, no execution rewrite.** The resolver decides allow-vs-prompt;
  the executed command string is left as the user/agent typed it (modulo the
  existing narrow prefix-normalization in `normalizePaths`). Rewriting would
  collapse `//` and mangle non-path args (`curl https://x` → `https:/x`) for no
  security gain — a confined path is correct as-typed, an escaping one prompts
  regardless.
- **Marker: reuse `<cmd> <base>/*`.** No new config field. Existing `cat ./*` /
  `find ~/code/*` entries start working correctly on upgrade. Only `*/`-tailed
  (trailing `/*`) entries become confined; plain globs (`grep *`) and the
  trailing `*` behavior are untouched. Trade-off accepted: a trailing `/*` no
  longer reads as a literal glob — documented in code.
- **Confinement is allowlist-only.** Blocklist entries keep plain-glob
  semantics.
- **Bare root `/*` unsupported.** It would confine to "everything" — degenerate.
  A confined base must be non-empty after stripping the trailing `/*`.

## Components (`extensions/safe-bash/rules.ts`)

### Confined-pattern parse

A pattern is confined iff it ends with `/*` and the base is non-empty.

- `base = <last whitespace token, with trailing "/*" removed>`
- `prefix = <everything before the last token>`

Examples: `cat ./*` → prefix `cat`, base `.`; `find ~/code/*` → prefix `find`,
base `~/code`; `git log ./*` → prefix `git log`, base `.`;
`tail /var/log/*` → prefix `tail`, base `/var/log`.

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
- For each argument token after `prefix`:
  1. Skip tokens starting with `-` (flags).
  2. Strip surrounding matching quotes (`"…"` / `'…'`).
  3. Split on `=` and test each part (catches `--file=/etc/passwd`).
  4. `absArg = resolveAbs(part, cwd, home)`; contained iff
     `absArg === absBase || absArg.startsWith(absBase + "/")`.
- Returns true iff the prefix matches and no argument falls outside `absBase`.

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
- **Flag styles beyond `=`-split** (unusual glued forms) not covered —
  `ponytail:` comment. Separately-tokenized flag values are already their own
  tokens and handled.

## Tests (`extensions/safe-bash/rules.test.ts`)

Cover every row of the behavior table, plus:

- confined-pattern parse: `cat ./*`, `find ~/code/*`, `git log ./*`,
  `tail /var/log/*`, and non-confined (`grep *`, `find ~/code/x` without `/*`)
- `resolveAbs`: `~/x` → home, `/abs` → itself, `x`/`./x` → cwd-joined,
  `./a/../b` collapse
- quote-stripped escape (`cat "../../etc/passwd"` → prompt)
- `=`-split escape (`cat --file=/etc/passwd` → prompt)
- flag skipped (`cat -n README.md` → allow)
- prefix mismatch (`lsof` vs `ls ./*`, `npm` vs `cat ./*`)
- multi-word prefix (`git log ./x` matches `git log ./*`, `git log /abs` prompts)
- integration: `normalizePaths` then match for a cwd-absolute and a home path
- no interaction with the trailing `*` rule (`ls *` still matches bare `ls`)
- `/*` bare-root base is not treated as confined
