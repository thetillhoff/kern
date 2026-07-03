import { posix as path } from "node:path";

// Shell separators that must not appear inside a single pattern. A pattern
// containing these would never match a segment (segments have separators
// stripped) and could indicate a bypass attempt if stored in the allowlist.
const SEPARATOR_RE = /&&|\|\||[|;]/;

// Command and process substitution syntax. Segments or patterns containing
// these are always prompted (never auto-approved via the allowlist) because
// the inner command is not split out and cannot be independently checked.
export const SUBST_RE = /\$\(|`|<\(|>\(/;

/**
 * Resolve a shell path token to a canonical absolute POSIX path, lexically —
 * no filesystem access, no symlink resolution. A leading `~` expands against
 * `home` (only the leading char, so `~foo` becomes `<home>foo`); a non-absolute
 * result joins against `cwd`; `normalize` collapses `.`/`..` segments.
 *
 * ponytail: `~user` (another user's home) mis-resolves to `<home>user`
 * instead of that user's actual home directory — safe direction (narrows,
 * never widens, the confined base), so left unhandled.
 */
export function resolveAbs(token: string, cwd: string, home: string): string {
	let t = token.startsWith("~") ? home + token.slice(1) : token;
	if (!path.isAbsolute(t)) t = path.join(cwd, t);
	return path.normalize(t);
}

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
 *
 * ponytail: a symlink inside `base` that points outside it is not detected —
 * this is lexical-only (no filesystem access, no realpath), so such a link
 * would test as contained even though it escapes at execution time.
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
				// ponytail: a glued flag+path with no '/' (e.g. `-f..`) is
				// indistinguishable from a pure flag and is skipped rather than
				// resolved — narrows the check, doesn't widen it.
				if (part.includes("/")) return false; // 3. glued flag+path → prompt
				continue; // pure flag
			}
			const abs = resolveAbs(part, cwd, home);
			if (abs !== absBase && !abs.startsWith(`${absBase}/`)) return false;
		}
	}
	return true;
}

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
	if (confined)
		return withinBase(command, confined.prefix, confined.base, cwd, home);
	return matchesPattern(command, pattern);
}

/**
 * Match a shell command string against a glob pattern.
 * `*` is a wildcard matching any sequence of characters and may appear at any
 * position (`git * commit *` is valid). Patterns containing shell separators
 * (`|`, `||`, `&&`, `;`) never match - use splitSegments + per-segment patterns
 * instead.
 */
const patternCache = new Map<string, RegExp>();

export function matchesPattern(command: string, pattern: string): boolean {
	if (SEPARATOR_RE.test(pattern)) return false;
	let re = patternCache.get(pattern);
	if (!re) {
		// A trailing " *" (the shape suggestPattern produces) means "this command
		// with any args, including none" — so `git status *` matches bare
		// `git status` too. Without this, every allow-always leaves the bare form
		// re-prompting forever.
		let core = pattern;
		let tail = "$";
		if (core.endsWith(" *")) {
			core = core.slice(0, -2);
			tail = "(?: .*)?$";
		}
		const escaped = core
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		re = new RegExp(`^${escaped}${tail}`);
		patternCache.set(pattern, re);
	}
	return re.test(command.trim());
}

/**
 * Return true when a pattern string is safe to store in the allowlist.
 * Rejects patterns containing shell separators.
 */
export function isValidPattern(pattern: string): boolean {
	const t = pattern.trim();
	return !SEPARATOR_RE.test(t) && !SUBST_RE.test(t);
}

/**
 * Split a command into its individual sub-commands on shell separators
 * (`|`, `||`, `&&`, `;`). `||` is matched before `|` so it is one separator,
 * not two empty splits. Each sub-command is approved/blocked on its own, so
 * `rm -rf / && ls` cannot ride in on a whole-string pattern.
 */
// Returns null when the command contains an unmatched quote — caller must block.
export function splitSegments(command: string): string[] | null {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (inSingle) {
			// No escapes inside single quotes (bash spec)
			if (ch === "'") inSingle = false;
			current += ch;
		} else if (inDouble) {
			if (ch === "\\" && i + 1 < command.length) {
				// consume next char as literal (covers \" staying in double-quote state)
				current += ch + command[++i];
			} else if (ch === '"') {
				inDouble = false;
				current += ch;
			} else {
				current += ch;
			}
		} else {
			// unquoted
			if (ch === "\\" && i + 1 < command.length) {
				// backslash escapes next char — stays unquoted, does NOT open a string
				current += ch + command[++i];
			} else if (ch === "'") {
				inSingle = true;
				current += ch;
			} else if (ch === '"') {
				inDouble = true;
				current += ch;
			} else {
				const two = command.slice(i, i + 2);
				if (two === "&&" || two === "||") {
					segments.push(current.trim());
					current = "";
					i++;
				} else if (ch === "|" || ch === ";") {
					segments.push(current.trim());
					current = "";
				} else {
					current += ch;
				}
			}
		}
	}

	if (inSingle || inDouble) return null; // unmatched quote — block

	if (current.trim()) segments.push(current.trim());
	return segments.filter(Boolean);
}

/**
 * Rewrite absolute home-directory paths to `~/…` so allowlist patterns are
 * username-independent. Replaces `/home/<user>/` and `/Users/<user>/` prefixes
 * (and their `$HOME/` equivalent) with `~/`. Only rewrites outside of quotes
 * so it cannot be exploited to collapse a quoted string argument.
 */
export function normalizePaths(
	command: string,
	home: string,
	cwd?: string,
): string {
	if (!home) return command;
	// Expand $HOME and ~/ to literal home so cwd matching works on a canonical path
	const expanded = command
		.replace(/\$HOME(?=\/|$)/g, home)
		.replace(/^~(?=\/|$)/, home)
		.replace(/ ~(?=\/|$)/g, ` ${home}`);
	// Replace cwd prefix before home prefix (cwd is more specific)
	let result = expanded;
	if (cwd) {
		const escapedCwd = cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		result = result.replace(new RegExp(`${escapedCwd}(?=/|$)`, "g"), ".");
	}
	const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return result.replace(new RegExp(`${escapedHome}(?=/|$)`, "g"), "~");
}

/**
 * Suggest an allowlist glob for a command: the first token plus " *".
 * The human edits this before it is stored, so a broad default is fine.
 * A trailing " *" matches the bare command too (see matchesPattern), so one
 * grant covers both `ls` and `ls -la`.
 */
export function suggestPattern(command: string): string {
	const trimmed = command.trim();
	const first = trimmed.split(/\s+/)[0] ?? "";
	if (!first) return "";
	return `${first} *`;
}
