#!/usr/bin/env bats

# Test setup for ideate command
setup() {
    export PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    # Use a system temp directory if BATS_TMPDIR is problematic
    if [[ "$BATS_TMPDIR" == "tmp/"* ]] || [[ -z "$BATS_TMPDIR" ]]; then
        export TEST_DIR="$(mktemp -d)"
    else
        export TEST_DIR="$BATS_TMPDIR/claude-evolve-test-$$"
    fi
    export ORIG_DIR="$PWD"
    mkdir -p "$TEST_DIR"
    # Don't cd in setup - do it in each test after skip check
}

teardown() {
    cd "$ORIG_DIR"
    rm -rf "$TEST_DIR"
}

@test "ideate: shows help when --help is passed" {
    cd "$TEST_DIR"
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve ideate" ]]
    [[ "$output" =~ "USAGE:" ]]
    [[ "$output" =~ "--no-ai" ]]
}

@test "ideate: fails when evolution workspace doesn't exist" {
    cd "$TEST_DIR"
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate 1
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Evolution workspace not found" ]]
}

@test "ideate: validates number of ideas range" {
    cd "$TEST_DIR"
    # Setup workspace first
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null
    
    # Test too low
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate 0
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Number of ideas must be between" ]]
    
    # Test too high
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate 51
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Number of ideas must be between" ]]
    
    # Test invalid format
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate abc
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Invalid number of ideas" ]]
}

@test "ideate: manual entry mode works" {
    cd "$TEST_DIR"
    # Setup workspace
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null
    
    # Test manual entry
    run bash -c "echo 'Test manual idea' | '$PROJECT_ROOT/bin/claude-evolve.sh' ideate --no-ai"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Manual entry mode" ]]
    [[ "$output" =~ "Added idea" ]]
    
    # Verify CSV was updated
    grep -q "Test manual idea" evolution/evolution.csv
}

@test "ideate: generates unique IDs" {
    cd "$TEST_DIR"
    # Setup workspace
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null
    
    # Add several ideas manually
    for i in {1..3}; do
        echo "Idea $i" | "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --no-ai >/dev/null
    done
    
    # Check that IDs are unique and sequential
    tail -n +2 evolution/evolution.csv | cut -d',' -f1 | sort | uniq -c | while read count id; do
        [ "$count" -eq 1 ]  # Each ID should appear exactly once
    done
}

@test "ideate: handles empty description gracefully" {
    cd "$TEST_DIR"
    # Setup workspace
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null
    
    # Try to add empty idea
    run bash -c "echo '' | '$PROJECT_ROOT/bin/claude-evolve.sh' ideate --no-ai"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Empty description" ]]
}

@test "ideate: no-ai flag skips AI generation" {
    cd "$TEST_DIR"
    # Setup workspace
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null
    
    # Should not prompt for AI when --no-ai is used
    run bash -c "echo '' | '$PROJECT_ROOT/bin/claude-evolve.sh' ideate --no-ai"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "No ideas generated" ]]
    [[ ! "$output" =~ "Generating.*idea.*with Claude" ]]
}