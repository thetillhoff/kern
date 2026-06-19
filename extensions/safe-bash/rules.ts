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
