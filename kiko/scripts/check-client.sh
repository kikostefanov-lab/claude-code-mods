#!/usr/bin/env bash
# The desktop can't load a Client surface module that imports other files at run time
# ("did not load within 10s"), so kiko.tsx may only have type imports.
set -euo pipefail
cd "$(dirname "$0")/../hooks"
bad=$(grep -nE "^\s*import\s" kiko.tsx | grep -vE "^\s*[0-9]+:\s*import type\s" || true)
bad+=$(grep -nE "^\s*export\s.*\sfrom\s" kiko.tsx || true)
if [ -n "$bad" ]; then
  echo "FAIL: kiko.tsx must be self-contained (type imports only):"
  echo "$bad"
  exit 1
fi
echo "OK: kiko.tsx has no runtime imports"
