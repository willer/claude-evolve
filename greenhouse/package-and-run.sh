#!/usr/bin/env bash
# Package a fresh "Evolve Greenhouse.app" and launch it.
#
# Unlike `npm start` (which runs the raw dist/ under electron), this builds the
# real distributable .app and opens THAT — the same artifact you'd ship. Because
# macOS `open` only focuses an already-running instance, any running copy is
# quit first so you actually land on the freshly built one.
set -euo pipefail
cd "$(dirname "$0")"

./package.sh

app=$(find release -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)
if [ -z "$app" ]; then
  echo "✗ no .app was produced under release/ — nothing to launch." >&2
  exit 1
fi

echo
echo "▶ quitting any running instance…"
osascript -e 'quit app "Evolve Greenhouse"' 2>/dev/null || true
pkill -f "Evolve Greenhouse.app/Contents/MacOS" 2>/dev/null || true
sleep 1

echo "▶ launching: $app"
open "$app"
