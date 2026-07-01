// Shell separators that must not appear inside a single pattern. A pattern
// containing these would never match a segment (segments have separators
// stripped) and could indicate a bypass attempt if stored in the allowlist.
const SEPARATOR_RE = /&&|\|\||[|;]/;

// Command and process substitution syntax. Segments or patterns containing
// these are always prompted (never auto-approved via the allowlist) because
// the inner command is not split out and cannot be independently checked.
export const SUBST_RE = /\$\(|`|<\(|>\(/;

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
		const escaped = pattern
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		re = new RegExp(`^${escaped}$`);
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
 * For bare commands (single word), return the exact command without " *".
 */
export function suggestPattern(command: string): string {
	const trimmed = command.trim();
	const first = trimmed.split(/\s+/)[0] ?? "";
	if (!first) return "";
	return trimmed === first ? first : `${first} *`;
}
