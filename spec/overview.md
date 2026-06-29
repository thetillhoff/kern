# kern — Project Spec

## What kern is

kern is a compiled binary that wraps the [Pi coding agent](https://github.com/earendil-works/pi)
(`@earendil-works/pi-coding-agent`) with a set of TypeScript extensions. It adds
intelligent model routing, bash command safety, URL fetching, context compaction
logging, MCP server integration, subagent delegation, and CLAUDE.md/PI.md loading
on top of the bare Pi agent.

The goal is a terminal-native AI coding environment usable out of the box.

## Repo layout

```text
kern/
├── kern.ts                  # entry point: imports extensions, calls pi main()
├── package.json             # root: bun build --compile kern.ts → ./kern binary
├── tsconfig.json            # root typecheck (kern.ts only)
├── extensions/              # Pi extension code (TypeScript, tested with bun test)
│   ├── package.json         # dev deps: @earendil-works/pi-coding-agent, biome, bun-types
│   ├── tsconfig.json
│   ├── shared/              # utilities shared across extensions
│   │   ├── model-rules.ts   # loadModelRules() reads ~/.pi/model-rules.json
│   │   └── append-jsonl.ts  # atomic JSONL append helper
│   ├── safe-bash/
│   ├── model-router/
│   ├── task/
│   ├── claude-compat/
│   ├── fetch-url/
│   ├── context-manager/
│   └── mcp-integration/
└── templates/               # copied to ~/.pi/ on install
    ├── settings.json
    ├── model-rules.json
    ├── mcp.json
    └── PI.md
```

## Build

```bash
bun install          # root
bun run build        # produces ./kern binary via bun build --compile --minify
```

## Runtime config files (all under `~/.pi/`)

| File | Purpose |
| --- | --- |
| `agent/settings.json` | Default provider/model, compaction settings, bash safety rules |
| `model-rules.json` | Tier→model map, Ollama classifier URL/model/timeout, default/fallback model |
| `PI.md` | Global system-prompt instructions (like `~/.claude/CLAUDE.md`) |
| `mcp.json` | MCP server list for auto-discovery |
| `model-decisions.jsonl` | Debug trace: one entry per routing decision |
| `compaction.jsonl` | One entry per context compaction event |
| `sessions/<childSessionId>.jsonl` | One entry per subagent run segment |

## Extension registration order

```ts
await main(process.argv.slice(2), {
  extensionFactories: [
    claudeCompat,
    contextManager,
    fetchUrl,
    mcpIntegration,
    modelRouter,
    safeBash,
    task,
  ],
});
```

## Cross-extension state

The Pi loader gives each extension its own module graph. Module-level singletons
(Map, Set) in a shared file are **not** shared between extensions — even when both
import the same path. For state that two extensions must share, use `globalThis`.

The model-router extension stores per-session routing state in
`globalThis.__kernModelRouterOverride` so the task extension can query/set it
without creating a circular import.

## Development

```bash
cd extensions
bun test                      # colocated *.test.ts files
npx tsc --noEmit              # type-check extensions
npx @biomejs/biome check .    # lint + format (tabs, not spaces)
```

Typecheck `kern.ts` from the repo root:

```bash
node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Biome uses **tabs**. Code copied from docs is often space-indented; run
`npx @biomejs/biome format --write <files>` before checking.

Logic that needs a live model (router decisions, the `task` continuation engine) cannot be
unit-tested. Smoke it against a real provider and record the run in `extensions/task/SMOKE.md`.
Always wrap `pi -p` in `timeout` — a nested model call can wedge with no output.

Markdown lint: `npx markdownlint-cli --disable MD013 -- <file>`. Tabs in code fences trigger
MD010 — expand to spaces in docs. No Python; Node/Bun only on the host.

## Pi API navigation

Pi has no API reference. Source of truth is the TypeScript declarations shipped
in `node_modules`:

- `extensions/node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` —
  `ExtensionAPI`, `ExtensionContext`, event names + payloads,
  `createAgentSession`/`CreateAgentSessionOptions`, `AgentSession`
- `extensions/node_modules/@earendil-works/pi-tui/dist/**/*.d.ts` — editor/UI

When `.d.ts` does not explain behaviour (defaults, control flow, when an event
fires), read the compiled `.js` next to it. Never guess a signature.

## Check before building

Several features are already built in. Before writing an extension, grep the dist for an
existing provider/handler and check the default wiring. Example: editor file-path autocomplete
(`~/`, `./`, mid-line `/`) already ships via pi-tui's `CombinedAutocompleteProvider` — no
extension needed. A few minutes of grep saves a redundant extension.

## Known traps

- **Cross-extension module state is not shared.** The loader gives each extension its own module
  graph, so a module-level `Map`/`Set` is invisible to other extensions — even when both import
  the same file. For state two extensions must share, use `globalThis`. Detect the duplication
  bug with temporary `console.error` probes: one side writes a key, the other reads `undefined`.
- **Subagent sessions start headless.** `createAgentSession` children get a no-op UI (confirms
  auto-deny, inputs return `undefined`). Forward the parent's UI explicitly so prompts reach the
  human.
- **Editor providers, system prompt, and skills** only reach a child session through the
  documented options (e.g. a resource loader), not by ambient inheritance — confirm in the
  `.d.ts` how to pass them.
- **External classifiers/tools cold-start slowly.** Separate the latency you *gate* on from the
  latency you *measure/log*.
