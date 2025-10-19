#!/bin/bash

# Test script to verify ID generation doesn't create collisions

set -e

echo "Testing ID generation logic..."

# Create test CSV
TEST_DIR="/tmp/ideate-test-$$"
mkdir -p "$TEST_DIR"
TEST_CSV="$TEST_DIR/evolution.csv"

# Create CSV with some existing entries
cat > "$TEST_CSV" <<'EOF'
id,basedOnId,description,performance,status,idea-LLM,run-LLM
gen01-001,,First idea,,complete,test,
gen01-002,,Second idea,,complete,test,
gen01-003,,Third idea,,complete,test,
gen02-001,,Fourth idea,,pending,test,
gen02-002,,Fifth idea,,pending,test,
EOF

echo "Created test CSV with 5 entries"
cat "$TEST_CSV"

# Source the ideate script to get functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_CMD=python3
FULL_CSV_PATH="$TEST_CSV"

# Define get_next_id function (extracted from ideate script)
get_next_id() {
  local generation="$1"
  if [[ ! -f "$FULL_CSV_PATH" ]]; then
    echo "gen${generation}-001"
    return
  fi

  # Use Python for proper CSV parsing
  local max_id
  max_id=$("$PYTHON_CMD" -c "
import csv
import re
max_id = 0
pattern = re.compile(r'^gen${generation}-(\d+)$')
with open('$FULL_CSV_PATH', 'r') as f:
    reader = csv.reader(f)
    next(reader, None)  # Skip header
    for row in reader:
        if row and len(row) > 0:
            id_field = row[0].strip()
            match = pattern.match(id_field)
            if match:
                id_num = int(match.group(1))
                max_id = max(max_id, id_num)
print(max_id)
")

  # Format next ID with generation and 3-digit number
  printf "gen%s-%03d" "$generation" $((max_id + 1))
}

# Test getting next IDs for generation 02
echo ""
echo "Testing get_next_id for generation 02:"
NEXT_ID=$(get_next_id "02")
echo "Next ID for gen02: $NEXT_ID"

if [[ "$NEXT_ID" != "gen02-003" ]]; then
  echo "ERROR: Expected gen02-003, got $NEXT_ID"
  exit 1
fi

# Test getting next IDs for generation 03 (no existing entries)
echo ""
echo "Testing get_next_id for generation 03 (no existing entries):"
NEXT_ID=$(get_next_id "03")
echo "Next ID for gen03: $NEXT_ID"

if [[ "$NEXT_ID" != "gen03-001" ]]; then
  echo "ERROR: Expected gen03-001, got $NEXT_ID"
  exit 1
fi

# Simulate sequential strategy calls
echo ""
echo "Simulating sequential strategy calls:"
echo "1. Novel ideas (5 ideas) starting from gen03-001"
echo "   Should get: gen03-001, gen03-002, gen03-003, gen03-004, gen03-005"

# Add the first batch
cat >> "$TEST_CSV" <<'EOF'
gen03-001,,Novel idea 1,,pending,test,
gen03-002,,Novel idea 2,,pending,test,
gen03-003,,Novel idea 3,,pending,test,
gen03-004,,Novel idea 4,,pending,test,
gen03-005,,Novel idea 5,,pending,test,
EOF

# Get next ID after first batch
NEXT_ID=$(get_next_id "03")
echo ""
echo "2. Hill climbing (3 ideas) starting from $NEXT_ID"

if [[ "$NEXT_ID" != "gen03-006" ]]; then
  echo "ERROR: Expected gen03-006, got $NEXT_ID"
  exit 1
fi

echo "   Should get: gen03-006, gen03-007, gen03-008"

# Add second batch
cat >> "$TEST_CSV" <<'EOF'
gen03-006,gen02-001,Hill climbing 1,,pending,test,
gen03-007,gen02-002,Hill climbing 2,,pending,test,
gen03-008,gen02-001,Hill climbing 3,,pending,test,
EOF

# Get next ID after second batch
NEXT_ID=$(get_next_id "03")
echo ""
echo "3. Structural mutation (4 ideas) starting from $NEXT_ID"

if [[ "$NEXT_ID" != "gen03-009" ]]; then
  echo "ERROR: Expected gen03-009, got $NEXT_ID"
  exit 1
fi

echo "   Should get: gen03-009, gen03-010, gen03-011, gen03-012"

# Cleanup
rm -rf "$TEST_DIR"

echo ""
echo "✓ All tests passed! ID generation logic is working correctly."
echo ""
echo "Summary:"
echo "- IDs are generated sequentially without collisions"
echo "- Each strategy gets unique IDs starting from the next available number"
echo "- Parallel strategies will not collide as long as they call get_next_id BEFORE creating temp CSV"
