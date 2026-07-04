import { posix as path } from "node:path";

// Shell separators that must not appear inside a single pattern. A pattern
// containing these would never match a segment (segments have separators
// stripped) and could indicate a bypass attempt if stored in the allowlist.
// Includes a single `&` (background operator) and newlines: both start a new
// command, so a segment must never span them.
const SEPARATOR_RE = /[|;&\n\r]/;

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

	// Defense in depth: a newline starts a new command. splitSegments already
	// splits on it before we are reached, but never approve args that span one —
	// otherwise a second command's words would be checked as this prefix's args.
	if (/[\n\r]/.test(rest)) return false;

	const absBase = resolveAbs(base, cwd, home);
	for (const token of rest.split(/\s+/).filter(Boolean)) {
		const unquoted = token.replace(/['"]/g, ""); // 1. strip all quotes
		for (const part of unquoted.split("=")) {
			// 2. split before flag check
			if (part === "") continue;
			// Unexpanded shell variables ($VAR/${VAR}) resolve to an unknown
			// value at execution time; we cannot prove containment, so fail safe.
			if (part.includes("$")) return false;
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
 * Returns true when a shell segment is a pure variable assignment — a bare
 * `NAME=value` with no command substitution. Such segments set a variable in
 * the current shell but execute nothing, so they need no independent approval.
 *
 * Matches:     SCRIPTS=/path/to/scripts, FOO=bar, _VAR=123
 * Does not match: VAR=$(cmd), A=`cmd`        — command substitution in value
 *                 env VAR=x cmd, cmd VAR=x    — assignment prefixing a command
 */
export function isPureAssignment(segment: string): boolean {
	const s = segment.trim();
	// Must start with a valid shell identifier immediately followed by `=`
	if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) return false;
	// Reject if the value contains command substitution (something executes)
	return !SUBST_RE.test(s);
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
 * Given a command string and the index of the first `<` of a `<<` or `<<-`
 * heredoc redirect, consume the entire heredoc (delimiter header + body lines +
 * terminator line) and return the text consumed and the index of the first
 * character after the heredoc. Returns null when the delimiter is empty
 * (malformed); an unterminated heredoc (EOF before delimiter) is returned
 * as-is so the caller can treat it as one segment rather than blocking.
 *
 * Delimiter quoting rules:
 *   `<< EOF`   – word is EOF (no quotes)
 *   `<< 'EOF'` – word is EOF (single quotes, no expansion in body)
 *   `<< "EOF"` – word is EOF (double quotes)
 * In all cases the terminator is a line whose content, after stripping leading
 * tabs when `<<-` is used, equals the unquoted delimiter word.
 */
function scanHeredoc(
	command: string,
	start: number,
): { end: number; text: string } | null {
	let i = start;
	let text = "";

	// consume `<<`
	text += command[i++]; // first '<'
	text += command[i++]; // second '<'

	// optional `-` for `<<-` (strips leading tabs from body lines and terminator)
	let stripTabs = false;
	if (i < command.length && command[i] === "-") {
		stripTabs = true;
		text += command[i++];
	}

	// skip optional whitespace before the delimiter word
	while (i < command.length && (command[i] === " " || command[i] === "\t")) {
		text += command[i++];
	}

	// read the delimiter word: everything up to (but not including) the newline
	let rawDelim = "";
	while (i < command.length && command[i] !== "\n" && command[i] !== "\r") {
		rawDelim += command[i];
		text += command[i++];
	}

	rawDelim = rawDelim.trim();
	if (rawDelim === "") return null; // empty delimiter – malformed

	// strip a matching pair of surrounding quotes (single or double)
	const strippedDelim = rawDelim.replace(/^(['"])(.*?)\1$/, "$2");

	// consume the newline that ends the `<<` line
	if (i < command.length && command[i] === "\r") text += command[i++];
	if (i < command.length && command[i] === "\n") text += command[i++];

	// scan body lines until we find the terminator
	while (i < command.length) {
		let line = "";
		while (i < command.length && command[i] !== "\n" && command[i] !== "\r") {
			line += command[i++];
		}

		// for `<<-`: strip leading tabs before comparing to the delimiter
		const checkLine = stripTabs ? line.replace(/^\t+/, "") : line;
		if (checkLine === strippedDelim) {
			text += line;
			if (i < command.length && command[i] === "\r") text += command[i++];
			if (i < command.length && command[i] === "\n") text += command[i++];
			return { end: i, text };
		}

		// body line – append without triggering a segment split
		text += line;
		if (i < command.length && command[i] === "\r") text += command[i++];
		if (i < command.length && command[i] === "\n") text += command[i++];
	}

	// reached EOF before the terminator – return what we consumed rather than
	// blocking, so an unterminated heredoc is still one segment.
	return { end: i, text };
}

// Shell keywords that open compound commands. When any of these appears as the
// first word of a (sub-)command (outside quotes), the whole command must be
// reviewed in one go. Splitting it on `&&` / `||` / `;` / `|` / newlines would
// produce meaningless fragments (`do`, `done`, `then`, `fi`, etc.) that cannot
// be individually understood or safely allowlist-matched.
const COMPOUND_KEYWORDS = new Set([
	"for",
	"while",
	"until",
	"if",
	"case",
	"select",
	"function",
]);

/**
 * Returns true when `command` contains a compound-command opening keyword
 * (`for`, `while`, `until`, `if`, `case`, `select`, `function`) as the first
 * shell word of any (sub-)command (outside of quotes).
 *
 * Used by `splitSegments` to skip the normal segment-splitting logic: the
 * whole command is returned as a single segment so the user reviews it as a
 * unit, not as a stream of disjointed keyword fragments.
 */
export function isCompoundCommand(command: string): boolean {
	let inSingle = false;
	let inDouble = false;
	// True while we are still looking for the first word of the current
	// (sub-)command (i.e. at a "command position" — start of string or
	// immediately after a shell separator).
	let lookingForFirstWord = true;
	let wordBuf = "";

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (inDouble) {
			if (ch === "\\" && i + 1 < command.length) i++;
			else if (ch === '"') inDouble = false;
			continue;
		}

		// unquoted territory
		if (ch === "\\" && i + 1 < command.length) {
			// backslash-escape: cannot be a bare keyword anymore
			lookingForFirstWord = false;
			wordBuf = "";
			i++;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			lookingForFirstWord = false;
			wordBuf = "";
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			lookingForFirstWord = false;
			wordBuf = "";
			continue;
		}

		// two-char operators — check buffered word, then enter new command position
		const two = command.slice(i, i + 2);
		if (two === "&&" || two === "||") {
			if (lookingForFirstWord && COMPOUND_KEYWORDS.has(wordBuf)) return true;
			lookingForFirstWord = true;
			wordBuf = "";
			i++; // skip second char
			continue;
		}

		// single-char separators
		if (ch === "|" || ch === ";" || ch === "&" || ch === "\n" || ch === "\r") {
			if (lookingForFirstWord && COMPOUND_KEYWORDS.has(wordBuf)) return true;
			lookingForFirstWord = true;
			wordBuf = "";
			continue;
		}

		// whitespace: finishes the current word
		if (ch === " " || ch === "\t") {
			if (lookingForFirstWord && wordBuf.length > 0) {
				if (COMPOUND_KEYWORDS.has(wordBuf)) return true;
				lookingForFirstWord = false; // past the first word of this sub-command
				wordBuf = "";
			}
			continue;
		}

		// regular character: accumulate only while looking for the first word
		if (lookingForFirstWord) wordBuf += ch;
	}

	// check any word still buffered at end-of-string
	return lookingForFirstWord && COMPOUND_KEYWORDS.has(wordBuf);
}

/**
 * Split a command into its individual sub-commands on shell separators
 * (`|`, `||`, `&&`, `;`). `||` is matched before `|` so it is one separator,
 * not two empty splits. Each sub-command is approved/blocked on its own, so
 * `rm -rf / && ls` cannot ride in on a whole-string pattern.
 *
 * Compound commands (`for`, `while`, `if`, etc.) are returned as a single
 * segment — they must be reviewed as a whole, not as disconnected keyword
 * fragments. See `isCompoundCommand`.
 */
// Returns null when the command contains an unmatched quote — caller must block.
export function splitSegments(command: string): string[] | null {
	// Compound control-flow constructs must be presented to the user in one
	// piece. Splitting them would produce individually-meaningless fragments
	// (`do`, `done`, `then`, `fi`, etc.) and break the approval flow.
	if (isCompoundCommand(command)) return [command.trim()];
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
				} else if (
					ch === "|" ||
					ch === ";" ||
					// `&` is a background / sequence operator UNLESS it is part of a
					// shell fd-redirect:
					//   >&n / >&-  — fd-redirect target marker   (e.g. 2>&1)
					//   &>  / &>>  — redirect-both-streams       (e.g. cmd &>/dev/null)
					(ch === "&" &&
						two !== "&>" && // not &> or &>> redirect
						!(i > 0 && command[i - 1] === ">")) || // not >& fd redirect
					ch === "\n" ||
					ch === "\r" // newline separates commands
				) {
					segments.push(current.trim());
					current = "";
				} else if (
					two === "<<" &&
					// guard against <<< (herestring): char before and char after
					// must not be `<`.
					(i === 0 || command[i - 1] !== "<") &&
					(i + 2 >= command.length || command[i + 2] !== "<")
				) {
					const heredoc = scanHeredoc(command, i);
					if (heredoc === null) return null; // malformed heredoc – block
					current += heredoc.text;
					i = heredoc.end - 1; // -1: the for-loop's i++ will advance to heredoc.end
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
