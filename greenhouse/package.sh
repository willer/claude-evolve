#!/usr/bin/env bash
# Build a fresh "Evolve Greenhouse.app": install deps → bundle → package.
#
# Run THIS after code changes, not `npm run build` alone: the running .app
# embeds its own copy of dist/ at package time, so a bare build never reaches
# it. When this finishes, QUIT the running app first (macOS `open` only focuses
# an already-running instance), then open the one printed below.
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 1/3  installing dependencies…"
npm install

echo "▶ 2/3  building renderer + main bundle…"
npm run build

echo "▶ 3/3  packaging .app (electron-builder)…"
npx electron-builder --mac dir

app=$(find release -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)
echo
echo "✅ packaged: ${app:-release/<mac>/Evolve Greenhouse.app}"
[ -n "$app" ] && echo "   quit the running app, then:  open \"$PWD/$app\""
