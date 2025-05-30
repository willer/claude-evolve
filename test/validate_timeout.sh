#!/bin/bash

set -euo pipefail

echo "=== Timeout Functionality Validation ==="

# Set up test environment
TEST_DIR="/Users/willer/GitHub/claude-evolve/timeout_test_$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Copy CLI script
cp /Users/willer/GitHub/claude-evolve/bin/claude-evolve.sh .
cp -r /Users/willer/GitHub/claude-evolve/lib .
cp /Users/willer/GitHub/claude-evolve/package.json .

# Set up mock Claude
export CLAUDE_CMD="/Users/willer/GitHub/claude-evolve/test/mock_claude.sh"

echo "1. Setting up evolution workspace..."
./claude-evolve.sh setup

echo "2. Creating slow evaluator for timeout test..."
cat > evolution/evaluator.py <<'EOF'
#!/usr/bin/env python3
import json
import time
import sys

# Sleep for 5 seconds to trigger timeout
time.sleep(5)

print(json.dumps({"score": 42.0, "status": "success"}))
EOF

chmod +x evolution/evaluator.py

echo "3. Adding test candidate to CSV..."
echo "id1,baseline,Test timeout candidate,0.0,empty" >> evolution/evolution.csv

echo "4. Testing timeout functionality with 2-second timeout..."
if timeout 10 ./claude-evolve.sh run --timeout 2; then
    echo "ERROR: Command should have failed due to timeout"
    exit 1
else
    echo "SUCCESS: Command correctly failed due to timeout"
fi

echo "5. Checking if candidate was marked as timeout..."
if grep -q "timeout" evolution/evolution.csv; then
    echo "SUCCESS: Candidate correctly marked as timeout"
else
    echo "ERROR: Candidate not marked as timeout"
    cat evolution/evolution.csv
    exit 1
fi

echo "6. Testing with fast evaluator..."
cat > evolution/evaluator.py <<'EOF'
#!/usr/bin/env python3
import json
print(json.dumps({"score": 42.0, "status": "success"}))
EOF

chmod +x evolution/evaluator.py

# Reset CSV for clean test
echo "id,basedOnId,description,performance,status" > evolution/evolution.csv
echo "id2,baseline,Test fast candidate,0.0,empty" >> evolution/evolution.csv

echo "7. Testing successful run with timeout..."
if ./claude-evolve.sh run --timeout 10; then
    echo "SUCCESS: Command completed within timeout"
    if grep -q "completed" evolution/evolution.csv; then
        echo "SUCCESS: Candidate correctly marked as completed"
    else
        echo "ERROR: Candidate not marked as completed"
        cat evolution/evolution.csv
        exit 1
    fi
else
    echo "ERROR: Command should have succeeded"
    exit 1
fi

# Cleanup
cd /Users/willer/GitHub/claude-evolve
rm -rf "$TEST_DIR"

echo "=== All timeout tests PASSED ==="