#!/bin/bash
# Test what O3 actually outputs

echo "Testing O3 output..."

# Simple test prompt
prompt="What is 2+2?"

echo "Running: codex exec -m o3 --dangerously-bypass-approvals-and-sandbox \"$prompt\""
output=$(codex exec -m o3 --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
exit_code=$?

echo "Exit code: $exit_code"
echo "Output length: ${#output} characters"
echo "Full output:"
echo "========================================="
echo "$output"
echo "========================================="

echo
echo "Checking for usage limit patterns..."
if echo "$output" | grep -qE "usage limit|rate limit|quota|429|Too Many Requests"; then
  echo "FOUND usage limit pattern"
else
  echo "NO usage limit pattern found"
fi

# Check for codex-specific patterns
echo
echo "Checking for codex-specific patterns..."
if echo "$output" | grep -qi "tokens used\|model limit\|context limit"; then
  echo "Found codex-specific pattern"
fi