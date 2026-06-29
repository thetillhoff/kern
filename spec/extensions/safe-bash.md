# Extension: safe-bash

Intercepts every `bash` tool call and enforces a blocklist/allowlist before the
command reaches the shell. Unknown commands are held for human approval, one
sub-command at a time.

## Config (`~/.pi/agent/settings.json`)

```json
{
  "bashSafety": {
    "blocklist": ["rm -rf /", "rm -rf ~"],
    "allowlist": ["git *", "bun *"],
    "requireConfirmForUnknown": true
  }
}
```

Default template ships with a sensible blocklist (fork-bombs, `mkfs`, etc.) and
an allowlist of common read-safe commands (`git *`, `bun *`, `npm *`, `npx *`,
`ls *`, `cat *`, `grep *`, `find *`, `echo *`).

## Behaviour

1. Split the command on shell separators (`|`, `||`, `&&`, `;`). `||` is matched
   before `|` so it counts as one separator.
2. If any segment matches the blocklist: block the whole command immediately, no
   prompt.
3. If `requireConfirmForUnknown` is false: allow everything not blocked.
4. For each remaining segment:
   - If the segment matches the allowlist: skip silently.
   - Otherwise: prompt the user with **Allow once / Allow always / Deny**.
     - **Allow always**: open an editable text field pre-populated with a
       suggested glob (`<first-token> *`, or bare command if single word). Validate
       that the saved pattern contains no shell separators. Append to the allowlist
       in `settings.json`. Apply in-memory immediately (covers remaining segments
       in the same command, future commands, and subagents).
     - **Deny**: block the command.
   - Identical segments within one command are not re-prompted.

The allowlist is re-read on every command call (not cached) so an "Allow always"
persists across restarts.

## Files

| File | Role |
| --- | --- |
| `index.ts` | `ExtensionAPI` wiring; reads config, splits command, runs the approval loop |
| `rules.ts` | `matchesPattern`, `isValidPattern`, `splitSegments`, `suggestPattern` |
| `allowlist.ts` | `appendAllowlistPattern` — atomic write of a new pattern to `settings.json` |

## Pattern matching

`matchesPattern(command, pattern)`:

- `*` is a wildcard that matches any sequence of characters anywhere in the pattern.
- Compiled to a regex and cached.
- A pattern containing shell separators never matches (defence against bypass).

`splitSegments(command)`:

- Splits on `&&`, `||`, `;`, `|` (in that order so `||` is one token).
- Trims and filters empty strings.
