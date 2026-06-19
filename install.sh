#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="$HOME/.pi"
PI_AGENT_DIR="$HOME/.pi/agent"

mkdir -p "$PI_AGENT_DIR"

echo "==> Linking extensions..."
target="$PI_AGENT_DIR/extensions"
if [ -L "$target" ]; then
  rm "$target"
elif [ -d "$target" ]; then
  echo "  ERROR: $target is a real directory, not a symlink. Remove it manually first."
  exit 1
fi
ln -s "$REPO_DIR/extensions" "$target"
echo "  Linked: extensions -> $target"

echo "==> Copying templates..."
for template in "$REPO_DIR/templates"/*; do
  name=$(basename "$template")
  case "$name" in
    settings.json)
      target="$PI_AGENT_DIR/settings.json"
      ;;
    *)
      target="$PI_DIR/$name"
      ;;
  esac
  if [ -f "$target" ]; then
    echo "  Skipped (exists): $target"
  else
    cp "$template" "$target"
    echo "  Created: $target"
  fi
done

echo "==> Done. Run: pi"
