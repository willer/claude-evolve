#!/bin/bash
# Test gemini's file editing capabilities

# Create a test CSV file
cat > test-gemini.csv << 'EOF'
id,parent_id,description,performance,status
gen00-000,0,baseline algorithm,50.23,complete
gen01-001,gen00-000,test idea 1,55.67,complete
gen01-002,gen00-000,test idea 2,48.90,complete
EOF

# Keep a backup for comparison
cp test-gemini.csv test-gemini.csv.bak

echo "Created test CSV file:"
cat test-gemini.csv
echo

echo "Testing gemini with file editing prompt..."
echo "Working directory: $(pwd)"
echo

# Test prompt that asks gemini to edit the CSV
prompt="Please use your file editing capabilities to append one new row to the CSV file: test-gemini.csv

The new row should have:
- id: gen01-003
- parent_id: gen00-000
- description: test idea 3
- performance: (leave empty)
- status: pending

IMPORTANT: Use your Edit or MultiEdit tool to modify the file. Do not just return text."

echo "Running: gemini -y -p \"<prompt>\""
gemini -y -p "$prompt"
exit_code=$?

echo
echo "Exit code: $exit_code"
echo
echo "CSV file after gemini:"
cat test-gemini.csv
echo

# Check if file was modified
original_lines=4
new_lines=$(wc -l < test-gemini.csv)
original_rows=$(grep -c '^gen' test-gemini.csv.bak)
new_rows=$(grep -c '^gen' test-gemini.csv)

echo "Line count: $original_lines -> $new_lines"
echo "Row count: $original_rows -> $new_rows"

if [[ $new_rows -gt $original_rows ]]; then
  echo "SUCCESS: Gemini added new row(s)"
else
  echo "FAILURE: Gemini did not add new rows"
fi

# Cleanup
rm -f test-gemini.csv test-gemini.csv.bak