#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_EXT_DIR="$HOME/.pi/agent/extensions"
PI_DIR="$HOME/.pi"
PI_AGENT_DIR="$HOME/.pi/agent"

mkdir -p "$PI_EXT_DIR"
mkdir -p "$PI_AGENT_DIR"

echo "==> Linking extensions..."
for ext_dir in "$REPO_DIR/extensions"/*/; do
  name=$(basename "$ext_dir")
  target="$PI_EXT_DIR/$name"
  # Remove existing symlink; leave real directories alone
  if [ -L "$target" ]; then
    rm "$target"
  fi
  ln -s "$ext_dir" "$target"
  echo "  Linked: $name -> $target"
done

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
