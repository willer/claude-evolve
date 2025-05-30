#!/bin/bash

# Run Bats tests with proper temporary directory setup
# This avoids the "tmp/bats-run-*/test/*.out: No such file or directory" errors

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Running Bats Test Suite ==="
echo "Setting TMPDIR and BATS_TMPDIR to /tmp to avoid relative path issues"
echo

# Export proper temp directories to avoid Bats tmp directory issues
export TMPDIR=/tmp
export BATS_TMPDIR=/tmp

# Run all Bats tests
if command -v bats >/dev/null 2>&1; then
  cd "$PROJECT_ROOT"
  bats test/*.bats
else
  echo "Error: Bats is not installed. Please install bats-core."
  echo "On macOS: brew install bats-core"
  echo "On Ubuntu/Debian: apt-get install bats"
  exit 1
fi
