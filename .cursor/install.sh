#!/usr/bin/env bash
# Idempotent install for Cursor Cloud Builds. Safe to run repeatedly.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

require_node() {
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 22 ]]; then
    echo "Node 22+ required; found $(node --version)" >&2
    exit 1
  fi
}

require_node

chmod +x foundry.mjs 2>/dev/null || true

# Zero npm dependencies — smoke-check the CLI without calling LLM APIs.
node foundry.mjs --help >/dev/null

echo "software-factory environment ready ($(node --version))"
