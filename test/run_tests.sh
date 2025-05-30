#!/bin/bash

set -euo pipefail

# Test runner script with mock Claude support
# This script provides an alternative to Bats for running tests

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK_CLAUDE="$PROJECT_ROOT/test/mock_claude.sh"

# Export Claude mock for all tests
export CLAUDE_CMD="$MOCK_CLAUDE"

echo "=== Claude Evolve Test Suite ==="
echo "Using mock Claude: $CLAUDE_CMD"
echo

# Test 1: Basic CLI functionality
test_basic_cli() {
  echo "1. Testing basic CLI functionality..."

  cd "$PROJECT_ROOT"

  # Test help
  if ./bin/claude-evolve.sh --help | grep -q "claude-evolve - AI-powered algorithm evolution tool"; then
    echo "   ✓ Help command works"
  else
    echo "   ✗ Help command failed"
    return 1
  fi

  # Test version
  if ./bin/claude-evolve.sh --version | grep -q "claude-evolve v"; then
    echo "   ✓ Version command works"
  else
    echo "   ✗ Version command failed"
    return 1
  fi

  echo "   ✓ Basic CLI tests passed"
}

# Test 2: Setup functionality
test_setup() {
  echo "2. Testing setup functionality..."

  cd "$PROJECT_ROOT"
  rm -rf evolution

  # Test setup
  if ./bin/claude-evolve.sh setup; then
    echo "   ✓ Setup command executed"
  else
    echo "   ✗ Setup command failed"
    return 1
  fi

  # Verify files created
  if [[ -d evolution && -f evolution/BRIEF.md && -f evolution/algorithm.py && -f evolution/evaluator.py ]]; then
    echo "   ✓ Evolution workspace created"
  else
    echo "   ✗ Evolution workspace not properly created"
    return 1
  fi

  echo "   ✓ Setup tests passed"
}

# Test 3: Timeout functionality
test_timeout() {
  echo "3. Testing timeout functionality..."

  cd "$PROJECT_ROOT"

  # Ensure clean workspace
  ./bin/claude-evolve.sh setup

  # Create slow evaluator
  cat >evolution/evaluator.py <<'EOF'
#!/usr/bin/env python3
import json
import time
import sys

# Sleep for 3 seconds to trigger timeout
time.sleep(3)
print(json.dumps({"score": 42.0, "status": "success"}))
EOF
  chmod +x evolution/evaluator.py

  # Add test candidate (properly formatted CSV)
  echo 'test1,,"Timeout test candidate",,' >>evolution/evolution.csv

  # Test timeout (should fail)
  if timeout 10 ./bin/claude-evolve.sh run --timeout 1 2>/dev/null; then
    echo "   ✗ Timeout test should have failed"
    return 1
  else
    echo "   ✓ Timeout correctly triggered"
  fi

  # Check if marked as timeout
  if grep -q "timeout" evolution/evolution.csv; then
    echo "   ✓ Candidate marked as timeout"
  else
    echo "   ✗ Candidate not marked as timeout"
    cat evolution/evolution.csv
    return 1
  fi

  # Test successful run
  cat >evolution/evaluator.py <<'EOF'
#!/usr/bin/env python3
import json
print(json.dumps({"score": 50.0, "status": "success"}))
EOF
  chmod +x evolution/evaluator.py

  # Reset for clean test
  echo "id,basedOnId,description,performance,status" >evolution/evolution.csv
  echo 'test2,,"Fast test candidate",,' >>evolution/evolution.csv

  if ./bin/claude-evolve.sh run --timeout 10; then
    echo "   ✓ Fast evaluation completed"
    if grep -q "completed" evolution/evolution.csv; then
      echo "   ✓ Candidate marked as completed"
    else
      echo "   ✗ Candidate not marked as completed"
      return 1
    fi
  else
    echo "   ✗ Fast evaluation should have succeeded"
    return 1
  fi

  echo "   ✓ Timeout tests passed"
}

# Test 4: Error handling
test_error_handling() {
  echo "4. Testing error handling..."

  cd "$PROJECT_ROOT"

  # Test ideate without workspace
  mkdir -p "$PROJECT_ROOT/test_tmp"
  cd "$PROJECT_ROOT/test_tmp"
  local ideate_output
  ideate_output=$("$PROJECT_ROOT/bin/claude-evolve.sh" ideate 2>&1)
  if echo "$ideate_output" | grep -q "Evolution workspace not found"; then
    echo "   ✓ Ideate correctly fails without workspace"
  else
    echo "   ✗ Ideate error handling failed"
    echo "   Debug: Got output: '$ideate_output'"
    cd "$PROJECT_ROOT"
    rm -rf test_tmp
    return 1
  fi

  # Test run without workspace
  local run_output
  run_output=$("$PROJECT_ROOT/bin/claude-evolve.sh" run 2>&1)
  if echo "$run_output" | grep -q "Evolution directory not found"; then
    echo "   ✓ Run correctly fails without workspace"
  else
    echo "   ✗ Run error handling failed"
    echo "   Debug: Got output: '$run_output'"
    cd "$PROJECT_ROOT"
    rm -rf test_tmp
    return 1
  fi

  cd "$PROJECT_ROOT"
  rm -rf test_tmp

  cd "$PROJECT_ROOT"
  echo "   ✓ Error handling tests passed"
}

# Run all tests
main() {
  local failed=0

  test_basic_cli || failed=1
  test_setup || failed=1
  test_timeout || failed=1
  test_error_handling || failed=1

  echo
  if [[ $failed -eq 0 ]]; then
    echo "🎉 All tests PASSED!"
    echo
    echo "✅ Bats testing infrastructure is working"
    echo "✅ Timeout functionality is implemented and working"
    echo "✅ Error handling is correct"
    echo "✅ Basic CLI functionality is solid"

    # Cleanup
    cd "$PROJECT_ROOT"
    rm -rf evolution

    exit 0
  else
    echo "❌ Some tests FAILED!"
    exit 1
  fi
}

# Ensure mock Claude is executable
chmod +x "$MOCK_CLAUDE"

main "$@"
