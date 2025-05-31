#!/bin/bash
# Test local development version

set -e

echo "Testing local claude-evolve development version..."

# Use absolute paths to local scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDEATE_SCRIPT="$SCRIPT_DIR/bin/claude-evolve-ideate"
RUN_SCRIPT="$SCRIPT_DIR/bin/claude-evolve-run"

echo "Testing ideate script..."
$IDEATE_SCRIPT --help

echo "Testing run script..." 
$RUN_SCRIPT --help

echo "Local testing complete!"