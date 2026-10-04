#!/usr/bin/env bash
# Renders one good and one broken diagram with the real mmdc, using the plugin's argv.
# MMDC overrides the binary; PUPPETEER_CONFIG passes a puppeteer JSON (CI needs --no-sandbox).
set -euo pipefail
MMDC=${MMDC:-$(command -v mmdc || zsh -lc 'command -v mmdc' 2>/dev/null || true)}
[ -n "$MMDC" ] || { echo "FAIL: mmdc not found (npm i -g @mermaid-js/mermaid-cli)"; exit 1; }
EXTRA=()
[ -n "${PUPPETEER_CONFIG:-}" ] && EXTRA=(-p "$PUPPETEER_CONFIG")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'sequenceDiagram\n  Alice->>Bob: hi\n' > "$tmp/good.mmd"
"$MMDC" -i "$tmp/good.mmd" -o "$tmp/good.svg" -b white -q --no-font-embed ${EXTRA[@]+"${EXTRA[@]}"}
head -c 400 "$tmp/good.svg" | grep -q '<svg' || { echo "FAIL: no <svg> in output"; exit 1; }
bytes=$(wc -c < "$tmp/good.svg" | tr -d ' ')
(( bytes <= 131072 )) || { echo "FAIL: $bytes bytes exceeds the 131072 inline limit"; exit 1; }
echo "OK: rendered $bytes bytes (inline limit 131072)"

"$MMDC" -i "$tmp/good.mmd" -o "$tmp/good.png" -b white -q ${EXTRA[@]+"${EXTRA[@]}"}
head -c 8 "$tmp/good.png" | grep -q 'PNG' || { echo "FAIL: no PNG written"; exit 1; }
echo "OK: rendered a PNG (terminal images)"

printf 'sequenceDiagram\n  Alice-->>\n' > "$tmp/bad.mmd"
if "$MMDC" -i "$tmp/bad.mmd" -o "$tmp/bad.svg" -b white -q --no-font-embed ${EXTRA[@]+"${EXTRA[@]}"} 2> "$tmp/err"; then
  echo "FAIL: broken diagram rendered"; exit 1
fi
grep -qiE 'parse error|syntax error|lexical error|no diagram type detected|unknowndiagramerror' "$tmp/err" \
  && echo "OK: syntax error recognised" \
  || { echo "FAIL: stderr not matched by SYNTAX_ERROR:"; cat "$tmp/err"; exit 1; }
