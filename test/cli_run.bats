#!/usr/bin/env bats

# Tests for the run command functionality

setup() {
    # Set up test environment
    TEST_DIR="$(mktemp -d)"
    export PROJECT_ROOT="$TEST_DIR"
    
    # Create directory structure
    mkdir -p "$TEST_DIR/evolution"
    mkdir -p "$TEST_DIR/lib"
    mkdir -p "$TEST_DIR/bin"
    
    # Copy source files
    cp "$BATS_TEST_DIRNAME/../lib/common.sh" "$TEST_DIR/lib/"
    cp "$BATS_TEST_DIRNAME/../bin/claude-evolve.sh" "$TEST_DIR/bin/"
    
    # Create test CSV
    cat > "$TEST_DIR/evolution/evolution.csv" <<EOF
id,basedOnId,description,performance,status
1,0,"Test algorithm",,
2,1,"Another test",,pending
EOF
    
    # Create test algorithm
    cat > "$TEST_DIR/evolution/algorithm.py" <<EOF
def test_algorithm():
    return "test"
EOF
    
    # Create test evaluator
    cat > "$TEST_DIR/evolution/evaluator.py" <<'EOF'
#!/usr/bin/env python3
import json
print(json.dumps({"score": 42.0, "status": "success"}))
EOF
    chmod +x "$TEST_DIR/evolution/evaluator.py"
    
    # Mock Claude command
    cat > "$TEST_DIR/mock_claude.sh" <<'EOF'
#!/bin/bash
echo 'def optimized_algorithm(): return "optimized"'
EOF
    chmod +x "$TEST_DIR/mock_claude.sh"
    
    # Source common functions
    source "$TEST_DIR/lib/common.sh"
}

teardown() {
    rm -rf "$TEST_DIR"
}

@test "find_oldest_empty_row finds first empty row" {
    result=$(find_oldest_empty_row "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "2" ]
}

@test "find_oldest_empty_row fails on non-existent file" {
    run find_oldest_empty_row "/nonexistent.csv"
    [ "$status" -eq 1 ]
    [[ "$output" == *"CSV file not found"* ]]
}

@test "update_csv_row updates performance and status" {
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 2 "123.45" "completed"
    
    # Check that row was updated
    result=$(awk -F, 'NR==2 {print $4 "," $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "123.45,completed" ]
}

@test "get_csv_row returns correct row data" {
    result=$(get_csv_row "$TEST_DIR/evolution/evolution.csv" 3)
    expected="2	1	\"Another test\"		pending"
    [ "$result" = "$expected" ]
}

@test "generate_evolution_id increments correctly" {
    result=$(generate_evolution_id "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "3" ]
}

@test "cmd_run fails when no empty rows" {
    # Mark all rows as completed  
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 2 "1.0" "completed"
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 3 "1.0" "completed"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 1 ]
    [[ "$output" =~ "No empty rows found" ]]
}

@test "cmd_run fails when evolution directory missing" {
    rm -rf "$TEST_DIR/evolution"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Evolution directory not found" ]]
}

@test "cmd_run successfully processes candidate with baseline algorithm" {
    # Create BRIEF.md for context
    cat > "$TEST_DIR/evolution/BRIEF.md" <<'EOF'
# Test Optimization Problem
We need to optimize a simple algorithm.
EOF
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Verify CSV was updated
    result=$(awk -F, 'NR==2 {print $4 "," $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "42.0,completed" ]
    
    # Verify algorithm file was generated
    [ -f "$TEST_DIR/evolution/evolution_id1.py" ]
    
    # Verify algorithm file contains expected content
    grep -q "optimized" "$TEST_DIR/evolution/evolution_id1.py"
}

@test "cmd_run successfully processes candidate based on parent algorithm" {
    # Create a parent algorithm file
    cat > "$TEST_DIR/evolution/evolution_id1.py" <<'EOF'
def parent_algorithm():
    return "parent"
EOF
    
    # Add a new candidate based on parent ID 1
    echo '3,1,"Child algorithm",,' >> "$TEST_DIR/evolution/evolution.csv"
    
    # Update first candidate to be completed
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 2 "10.0" "completed"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Verify the child algorithm was generated
    [ -f "$TEST_DIR/evolution/evolution_id3.py" ]
    
    # Verify CSV was updated for the child
    result=$(awk -F, 'NR==4 {print $4 "," $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "42.0,completed" ]
}

@test "cmd_run handles evaluator that returns different JSON formats" {
    # Create evaluator that returns performance field instead of score
    cat > "$TEST_DIR/evolution/evaluator.py" <<'EOF'
#!/usr/bin/env python3
import json
print(json.dumps({"performance": 55.5, "status": "success"}))
EOF
    chmod +x "$TEST_DIR/evolution/evaluator.py"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Verify performance score was correctly parsed
    result=$(awk -F, 'NR==2 {print $4}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "55.5" ]
}

@test "cmd_run properly marks candidate as running during execution" {
    # Create a slow evaluator to test intermediate status
    cat > "$TEST_DIR/evolution/evaluator.py" <<'EOF'
#!/usr/bin/env python3
import json
import time
# Simulate some work
time.sleep(0.1)
print(json.dumps({"score": 99.9, "status": "success"}))
EOF
    chmod +x "$TEST_DIR/evolution/evaluator.py"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Should be marked as completed after successful run
    result=$(awk -F, 'NR==2 {print $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "completed" ]
}

@test "cmd_run generates unique algorithm filenames" {
    # Complete the first candidate
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 2 "10.0" "completed"
    
    # Add multiple candidates
    echo '3,0,"Third algorithm",,' >> "$TEST_DIR/evolution/evolution.csv"
    echo '4,0,"Fourth algorithm",,' >> "$TEST_DIR/evolution/evolution.csv"
    
    # Run first available candidate (ID 3)
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Verify correct algorithm file was generated
    [ -f "$TEST_DIR/evolution/evolution_id3.py" ]
    [ ! -f "$TEST_DIR/evolution/evolution_id4.py" ]
    
    # Run second candidate
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Now fourth algorithm should exist
    [ -f "$TEST_DIR/evolution/evolution_id4.py" ]
}

@test "cmd_run preserves algorithm file extensions" {
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 0 ]
    
    # Verify .py extension is preserved
    [ -f "$TEST_DIR/evolution/evolution_id1.py" ]
    [[ "$TEST_DIR/evolution/evolution_id1.py" == *.py ]]
}

@test "cmd_run handles missing parent algorithm gracefully" {
    # Add candidate that references non-existent parent
    echo '3,999,"Based on missing parent",,' >> "$TEST_DIR/evolution/evolution.csv"
    
    # Mark first two as completed to make the third one active
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 2 "10.0" "completed"
    update_csv_row "$TEST_DIR/evolution/evolution.csv" 3 "20.0" "completed"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Parent algorithm file not found" ]]
    
    # Verify candidate was marked as failed
    result=$(awk -F, 'NR==4 {print $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "failed" ]
}

@test "cmd_run --timeout option handles timeout correctly" {
    # Create a slow evaluator that will timeout
    cat > "$TEST_DIR/evolution/evaluator.py" <<'EOF'
#!/usr/bin/env python3
import json
import time
# Sleep longer than the timeout
time.sleep(3)
print(json.dumps({"score": 42.0, "status": "success"}))
EOF
    chmod +x "$TEST_DIR/evolution/evaluator.py"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run --timeout 1
    [ "$status" -eq 1 ]
    [[ "$output" =~ "timed out after 1 seconds" ]]
    
    # Verify candidate was marked as timeout
    result=$(awk -F, 'NR==2 {print $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "timeout" ]
}

@test "cmd_run --timeout option validates input" {
    cd "$TEST_DIR"
    
    # Test invalid timeout values
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run --timeout abc
    [ "$status" -eq 1 ]
    [[ "$output" =~ "requires a positive integer" ]]
    
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run --timeout 0
    [ "$status" -eq 1 ]
    [[ "$output" =~ "must be greater than 0" ]]
    
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run --timeout -5
    [ "$status" -eq 1 ]
    [[ "$output" =~ "requires a positive integer" ]]
}

@test "cmd_run --timeout option works with valid timeout" {
    # Create a fast evaluator that completes before timeout
    cat > "$TEST_DIR/evolution/evaluator.py" <<'EOF'
#!/usr/bin/env python3
import json
print(json.dumps({"score": 42.0, "status": "success"}))
EOF
    chmod +x "$TEST_DIR/evolution/evaluator.py"
    
    cd "$TEST_DIR"
    run env CLAUDE_CMD="$TEST_DIR/mock_claude.sh" "$TEST_DIR/bin/claude-evolve.sh" run --timeout 10
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Using timeout: 10 seconds" ]]
    
    # Verify candidate was marked as completed (not timeout)
    result=$(awk -F, 'NR==2 {print $4 "," $5}' "$TEST_DIR/evolution/evolution.csv")
    [ "$result" = "42.0,completed" ]
}

@test "cmd_run --help shows timeout option" {
    cd "$TEST_DIR"
    run "$TEST_DIR/bin/claude-evolve.sh" run --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "--timeout" ]]
    [[ "$output" =~ "Kill evaluator after specified seconds" ]]
}