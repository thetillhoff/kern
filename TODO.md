# TODO

## Backlog

Things worth doing but not blocking immediate use.

### Pi extensions

- **`model-router`: Ollama mobile path** - Ollama won't work on mobile; consider
  Transformers.js (ONNX) as a portable embedded classifier for cross-platform use.
- **`fetch-url`: respect `robots.txt`** - Currently ignores it. Add a flag to enable/disable.
- **`mcp-integration`: auth headers** - `~/.pi/mcp.json` has no auth field. Add optional
  `headers` per server for bearer tokens.
- **`context-manager`: custom summary strategy** - Currently just logs and lets Pi compact
  normally. Could return a structured summary from `session_before_compact` to control what
  gets preserved.
- **Settings hot-reload** - Extensions read config once per call. Detect file changes and
  reload without restarting Pi.

### Infrastructure

- **Recreate `install.sh`** - The dev-setup script was deleted; `README` no longer references
  it. Recreate a script that symlinks extensions into `~/.pi/agent/extensions` and copies
  templates to `~/.pi/` so developers can run `pi` directly against live source without
  rebuilding the `kern` binary.
- **Distribute via Homebrew** - Add a formula in `~/code/thetillhoff/homebrew-tap`. Match the
  tap's pattern: per-arch binaries (`darwin/linux` x `arm64/amd64`) published to GitHub
  Releases at `releases/download/<version>/kern_<os>_<arch>`, a templated `template/kern.rb`
  (version + per-arch SHA placeholders) rendered into `Formula/kern.rb`, Renovate-bumped like
  the other formulae. Needs the `bun build --compile` cross-arch binary output and a release
  workflow that builds, uploads, and updates the formula.
