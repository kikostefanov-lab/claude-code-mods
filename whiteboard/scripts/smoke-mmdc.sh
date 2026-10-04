#!/bin/zsh -l
# Renders one good and one broken diagram with the real mmdc, using the plugin's argv.
set -euo pipefail
MMDC=$(command -v mmdc)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'sequenceDiagram\n  Alice->>Bob: hi\n' > "$tmp/good.mmd"
"$MMDC" -i "$tmp/good.mmd" -o "$tmp/good.svg" -b white -q --no-font-embed
head -c 400 "$tmp/good.svg" | grep -q '<svg' || { echo "FAIL: no <svg> in output"; exit 1; }
bytes=$(wc -c < "$tmp/good.svg" | tr -d ' ')
(( bytes <= 131072 )) || { echo "FAIL: $bytes bytes exceeds the 131072 inline limit"; exit 1; }
echo "OK: rendered $bytes bytes (inline limit 131072)"

printf 'sequenceDiagram\n  Alice-->>\n' > "$tmp/bad.mmd"
if "$MMDC" -i "$tmp/bad.mmd" -o "$tmp/bad.svg" -b white -q --no-font-embed 2> "$tmp/err"; then
  echo "FAIL: broken diagram rendered"; exit 1
fi
grep -qiE 'parse error|syntax error|lexical error|no diagram type detected|unknowndiagramerror' "$tmp/err" \
  && echo "OK: syntax error recognised" \
  || { echo "FAIL: stderr not matched by PARSE_ERROR:"; cat "$tmp/err"; exit 1; }
