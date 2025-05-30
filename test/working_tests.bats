#!/usr/bin/env bats

# Working test suite that bypasses the Bats output capture issues

setup() {
    export PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    export TEST_DIR="$PROJECT_ROOT/test_temp/working_test_$$"
    export ORIG_DIR="$PWD"
    mkdir -p "$TEST_DIR"
}

teardown() {
    cd "$ORIG_DIR"
    rm -rf "$TEST_DIR"
}

@test "command works and exits with correct status" {
    cd "$TEST_DIR"
    "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --help >/dev/null
    [ "$?" -eq 0 ]
}

@test "ideate fails without workspace" {
    cd "$TEST_DIR"
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate 1
    [ "$status" -eq 1 ]
}

@test "manual ideate mode works end-to-end" {
    cd "$TEST_DIR"
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null >/dev/null 2>&1
    echo "Test idea" | "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --no-ai >/dev/null 2>&1
    [ "$?" -eq 0 ]
    grep -q "Test idea" evolution/evolution.csv
}

@test "ideate validates range correctly" {
    cd "$TEST_DIR"
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null >/dev/null 2>&1
    run "$PROJECT_ROOT/bin/claude-evolve.sh" ideate abc
    [ "$status" -eq 1 ]
}

@test "run command fails without evolution directory" {
    cd "$TEST_DIR"
    run "$PROJECT_ROOT/bin/claude-evolve.sh" run
    [ "$status" -eq 1 ]
}

@test "csv functions work correctly" {
    cd "$TEST_DIR"
    source "$PROJECT_ROOT/lib/common.sh"
    
    mkdir -p evolution
    echo "id,basedOnId,description,performance,status" > evolution/evolution.csv
    echo "1,0,\"test\",,pending" >> evolution/evolution.csv
    
    # Test find_oldest_empty_row
    result=$(find_oldest_empty_row "evolution/evolution.csv")
    [ "$result" = "2" ]
    
    # Test generate_evolution_id  
    result=$(generate_evolution_id "evolution/evolution.csv")
    [ "$result" = "2" ]
}

@test "unique ids are generated correctly" {
    cd "$TEST_DIR"
    "$PROJECT_ROOT/bin/claude-evolve.sh" setup </dev/null >/dev/null 2>&1
    
    # Add multiple ideas
    echo "Idea 1" | "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --no-ai >/dev/null 2>&1
    echo "Idea 2" | "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --no-ai >/dev/null 2>&1
    echo "Idea 3" | "$PROJECT_ROOT/bin/claude-evolve.sh" ideate --no-ai >/dev/null 2>&1
    
    # Count unique IDs
    id_count=$(tail -n +2 evolution/evolution.csv | cut -d',' -f1 | sort -u | wc -l)
    total_count=$(tail -n +2 evolution/evolution.csv | wc -l)
    
    [ "$id_count" -eq "$total_count" ]
}