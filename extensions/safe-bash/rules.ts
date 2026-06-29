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
export function splitSegments(command: string): string[] {
	return command
		.split(/&&|\|\||;|\|/)
		.map((s) => s.trim())
		.filter(Boolean);
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
