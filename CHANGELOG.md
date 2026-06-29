# Changelog

## v0.2.0

### Added

- `claude-compat`: `resources_discover` event now returns skill paths from `~/.claude/skills/` and project-local `.claude/skills/` via the new `claudeSkillPaths` helper.
- `safe-bash`: concurrent permission prompts serialized via `queuedSelect` in `shared/permission-queue.ts`; parallel tool calls no longer stack overlapping approval dialogs.

### Security

- `fetch-url`: `fetchText` no longer follows redirects automatically; each hop's
  destination is re-validated against the SSRF blocklist, preventing open-redirect
  bypass to private/loopback hosts.
- `fetch-url`: hostname DNS pre-resolution added via `dns.lookup`; hostnames that
  resolve to private IPs are blocked before the connection is made.

### Fixed

- `fetch-url`: redirect check now matches only actual redirect status codes
  (301, 302, 303, 307, 308); previously the 3xx catch-all treated 304 Not
  Modified as a redirect, throwing on the missing Location header.
- `fetch-url`: redirect loop bound corrected to `i <= MAX_REDIRECTS`; the
  previous `i < MAX_REDIRECTS` silently capped redirects at 4 hops instead of 5.
- `fetch-url`: `validateUrlWithDns` no longer parses the URL twice; the
  redundant `try/catch` after the `validateUrl` call is removed.
- `task`: `resolveModelByTier` now warns when falling back to `defaultModel`
  for an unmapped tier, and returns `undefined` (instead of spawning on the
  wrong model) when the configured model id is not in the registry.
- `task`: `RouterConfig` moved to `shared/model-rules.ts` with a shared
  `loadModelRules` helper; eliminates silent schema drift between the task and
  model-router config readers.
- `safe-bash`: blocklist and allowlist checks in the `tool_call` handler now
  call `matchesPattern` directly on the pre-split segment instead of
  `matchesAny`, avoiding a redundant internal `splitSegments` call.
- `safe-bash`: `matchesAny` removed from `rules.ts`; it was dead production
  code after the inline `.some()` refactor.
- `safe-bash`: `appendAllowlistPattern` failure now shows a warning and grants
  an in-session allow instead of blocking the command; the previous behavior
  blocked every execution until the user restarted the session.
- `fetch-url`: response body now streamed up to 2 MB before decoding; previously
  `response.text()` buffered the entire body, risking OOM on large responses.
- `fetch-url`: `readBodyLimited` now respects the `charset` from the
  `Content-Type` header; previously always decoded as UTF-8 regardless of
  the server's declared encoding.
- `fetch-url`: DNS rebinding test coverage: `afterEach` resets `dns.lookup` to
  the benign mock so per-test overrides do not bleed; explicit test verifies
  `validateUrlWithDns` rejects hostnames that resolve to private IPs.
- `fetch-url`: SSRF filter now blocks `::` (IPv6 unspecified address) and all ULA
  addresses in compressed form (e.g. `fc::1`); switched from fragile per-prefix
  regexes to a `f[cd]` prefix match covering the entire `fc00::/7` range.
- `safe-bash`: `suggestPattern` for a bare command (no arguments) returns the
  command itself as the pattern instead of `cmd *`, which never matched the bare
  invocation.
- `safe-bash`: `appendAllowlistPattern` now returns `boolean`; the caller notifies
  the user and blocks the command when the pattern could not be persisted due to
  malformed `settings.json`.
- `safe-bash`: `suggestPattern` returns an empty string for empty commands instead
  of `*`, preventing accidental blanket allow-all rules.
- `claude-compat`: global `~/.claude/CLAUDE.md` is no longer injected into the
  pi agent system prompt by default; it is only read when `globalClaudeDir` is
  explicitly provided to `loadPIMd`.
- `mcp-integration`: per-server registered-tool set cleared when a server returns
  0 tools; previously the stale set prevented re-registration on recovery.
- `mcp-integration`: added `response.ok` guard before `response.json()` in tool
  execute; parallel server fetches replace sequential loop; per-server tool
  tracking replaces a flat Set so removed-and-re-added tools are re-registered;
  warns when a previously-live server returns no tools.
- `model-router`: deduplicated config file reads — `session_start` loads the
  config once and `before_agent_start` reuses it; extracted `defaultConfig()` to
  eliminate duplicated literal in `loadConfig`.
- `model-router` tests: `afterEach` now calls `clearStore()` instead of
  hard-coding session IDs, preventing state leaks from future tests.
- `task`: `model_tier` override now resolved directly via `createAgentSession`'s
  `model` option; the previous `globalThis` store approach was silently ignored
  because child sessions have no model-router extension.
- `task`: `augmentTools` called once instead of twice in the `createAgentSession`
  spread.
- `task`: `setTierOverride` moved immediately before `session.prompt()` to
  minimize the abort-race window with `before_agent_start`.
- `model-router`: `takeTierOverride` call removed from `before_agent_start`;
  `setTierOverride` is no longer called anywhere so the branch was permanently
  dead.

### Removed

- `install.sh` dev-setup script (deleted; see TODO for replacement).

### Chore

- CI: `fetch-url` test mock for `dns.lookup` cast via `unknown` to satisfy TypeScript's
  multi-overload signature check.
- CI: biome import-order and format corrections in `fetch-url`, `claude-compat`, and `task`.
- CI: biome format corrections in `fetcher.ts` (line-length splits for if-guards, try/catch, and method chains).

## v0.1.0

Initial release.
