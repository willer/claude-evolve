#!/bin/bash
#
# package.sh — fresh-checkout bootstrap for Evolve Greenhouse.
#
# From a clean clone (no node_modules), this does EVERYTHING needed to get a
# runnable / packaged app:
#   1. pick a Node that npm + the deps actually support
#   2. npm install
#   3. ensure Electron's prebuilt binary is in place (sandbox installs skip it)
#   4. rebuild node-pty against Electron's ABI
#   5. build the TS bundle (esbuild)
#   6. package the .app (electron-builder)
#
# Usage:
#   ./package.sh            # install + build + package a .app dir (release/)
#   ./package.sh dmg        # install + build + full electron-builder dist (.dmg)
#   ./package.sh build      # install + build only (no packaging)
#   ./package.sh install    # install + native deps only
#
set -euo pipefail

# Always operate from the script's own directory, regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-package}"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. pick a supported Node -------------------------------------------------
# npm 11 + vite/vitest/electron-builder want Node ^20.17 || >=22.9 (even/LTS).
# An odd-numbered or too-old Node "works" but emits EBADENGINE noise and is
# riskier for the native rebuild. Prefer a good one if the active node is bad.
node_ok() {
  # $1 = path to a node binary; returns 0 if its version is supported.
  local bin="$1" ver major minor
  [ -x "$bin" ] || command -v "$bin" >/dev/null 2>&1 || return 1
  ver="$("$bin" -v 2>/dev/null | sed 's/^v//')" || return 1
  major="${ver%%.*}"
  minor="$(printf '%s' "$ver" | cut -d. -f2)"
  if [ "$major" -eq 20 ] && [ "$minor" -ge 17 ]; then return 0; fi
  if [ "$major" -ge 22 ] && [ $(( major % 2 )) -eq 0 ]; then return 0; fi
  return 1
}

if ! node_ok "$(command -v node || true)"; then
  active_ver="$(node -v 2>/dev/null || echo none)"
  warn "active node ($active_ver) is unsupported by npm/deps; looking for a better one"
  for cand in /opt/homebrew/bin/node /usr/local/bin/node; do
    if node_ok "$cand"; then
      export PATH="$(dirname "$cand"):$PATH"
      log "using node from $cand ($("$cand" -v))"
      break
    fi
  done
  if ! node_ok "$(command -v node || true)"; then
    warn "no supported node found — continuing on $(node -v) (expect EBADENGINE warnings)"
  fi
fi
log "node $(node -v), npm $(npm -v)"

# --- 2. install dependencies --------------------------------------------------
if [ -f package-lock.json ]; then
  log "installing dependencies (npm ci)"
  npm ci || { warn "npm ci failed; falling back to npm install"; npm install; }
else
  log "installing dependencies (npm install)"
  npm install
fi

[ "$MODE" = "install" ] && { log "install complete"; exit 0; }

# --- 3. ensure Electron's prebuilt binary is present --------------------------
# Sandboxed npm installs can skip Electron's postinstall download, leaving an
# empty dist/. Recover it from the local Electron cache. (See CLAUDE.md.)
ELECTRON_DIST="node_modules/electron/dist"
if [ ! -e "$ELECTRON_DIST/Electron.app" ]; then
  warn "Electron binary missing; recovering from cache"
  want_ver="$(cat node_modules/electron/package.json 2>/dev/null \
    | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1 || true)"
  arch="$(uname -m)"; [ "$arch" = "x86_64" ] && arch="x64"
  cache="$HOME/Library/Caches/electron"
  zip="$(find "$cache" -name "electron-v${want_ver}-darwin-${arch}.zip" 2>/dev/null | head -1)"
  [ -z "$zip" ] && zip="$(find "$cache" -name "electron-v*-darwin-${arch}.zip" 2>/dev/null | head -1)"
  if [ -n "$zip" ] && [ -f "$zip" ]; then
    mkdir -p "$ELECTRON_DIST"
    unzip -oq "$zip" -d "$ELECTRON_DIST"
    # path.txt must contain EXACTLY this string with NO trailing newline.
    printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
    log "restored Electron from $(basename "$zip")"
  else
    die "Electron binary missing and no cached zip found in $cache (run a normal 'npm install' on an unsandboxed network first)"
  fi
fi

# --- 4. rebuild native module (node-pty) against Electron's ABI ---------------
log "rebuilding native modules for Electron"
npm run rebuild-native

# --- 5. build the bundle ------------------------------------------------------
log "building bundle"
npm run build

[ "$MODE" = "build" ] && { log "build complete (dist/)"; exit 0; }

# --- 6. package ---------------------------------------------------------------
case "$MODE" in
  package|dir)
    log "packaging .app (electron-builder --mac dir)"
    npm run package
    log "done — see release/"
    ;;
  dmg|dist)
    log "packaging distributable (electron-builder --mac)"
    npm run dist
    log "done — see release/"
    ;;
  *)
    die "unknown mode '$MODE' (use: package | dmg | build | install)"
    ;;
esac
