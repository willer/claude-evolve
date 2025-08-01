#!/bin/bash
# Test ideation with verbose output

# Set verbose output
export VERBOSE_AI_OUTPUT=true
export DEBUG_AI_CALLS=true
export DEBUG_AI_SUCCESS=true

# Test with a small evolution directory
cd /Users/willer/GitHub/trading-strategies/evolution-mats-tqqq || exit 1

echo "Starting ideation test..."
echo "Working directory: $(pwd)"
echo "Config file: config.yaml"
echo

# Run ideation with just 1 idea to test quickly
echo "Running: claude-evolve ideate --legacy 1"
/Users/willer/GitHub/claude-evolve/bin/claude-evolve ideate --legacy 1
exit_code=$?

echo
echo "Exit code: $exit_code"
echo

# Check if CSV was modified
if [[ -f evolution.csv ]]; then
  echo "CSV file contents (last 5 lines):"
  tail -5 evolution.csv
fi