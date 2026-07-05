#!/usr/bin/env bash
# Run a command under a Node.js new enough to require() ESM (>= v20.19 or v22+).
#
# Why: electron-builder 26 (app-builder-lib) does
#   require("@noble/hashes/blake2.js")
# and @noble/hashes@2 is ESM-only. On Node < 22 (e.g. an nvm-active v21) that
# throws ERR_REQUIRE_ESM and the whole `package`/`dist` run dies before it even
# starts. require(esm) landed in Node 22 (and was backported to 20.19), so we
# hunt down a new-enough node just for the packaging step and exec under it.
#
# Usage: scripts/with-node22.sh <command> [args...]
set -euo pipefail

node_ok() {
  # major >= 22, or 20.19+ (the LTS backport). Node 21 never got require(esm).
  [ -x "$1" ] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=22||(a===20&&b>=19)?0:1)' 2>/dev/null
}

# Candidate binaries, most-preferred first. nvm installs are expanded (highest
# version first) so a good node found there wins over an ancient system one.
candidates=()
[ -n "${NODE22:-}" ] && candidates+=("$NODE22")
candidates+=("$(command -v node 2>/dev/null || true)")
if [ -d "${NVM_DIR:-$HOME/.nvm}/versions/node" ]; then
  while IFS= read -r d; do candidates+=("$d/bin/node"); done \
    < <(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/ 2>/dev/null | sort -rV)
fi
candidates+=(
  /opt/homebrew/bin/node
  /usr/local/bin/node
  /opt/homebrew/opt/node@22/bin/node
  /opt/homebrew/opt/node@20/bin/node
)

for bin in "${candidates[@]}"; do
  if node_ok "$bin"; then
    dir=$(dirname "$bin")
    echo "▸ using node $("$bin" -v) ($bin)" >&2
    exec env PATH="$dir:$PATH" "$@"
  fi
done

echo "✗ no Node >= 22 (or 20.19+) found — electron-builder needs one to require() ESM." >&2
echo "  active node is $(node -v 2>/dev/null || echo none); install e.g. 'brew install node' or 'nvm install 22'." >&2
exit 1
