#!/usr/bin/env bats

# Basic CLI functionality tests

setup() {
    export PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    export CLI_SCRIPT="$PROJECT_ROOT/bin/claude-evolve.sh"
}

@test "CLI script exists and is executable" {
    [ -x "$CLI_SCRIPT" ]
}

@test "--help flag shows help and exits with code 0" {
    run "$CLI_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve - AI-powered algorithm evolution tool" ]]
    [[ "$output" =~ "USAGE:" ]]
    [[ "$output" =~ "COMMANDS:" ]]
}

@test "-h flag shows help and exits with code 0" {
    run "$CLI_SCRIPT" -h
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve - AI-powered algorithm evolution tool" ]]
}

@test "help command shows help and exits with code 0" {
    run "$CLI_SCRIPT" help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve - AI-powered algorithm evolution tool" ]]
}

@test "--version flag shows version and exits with code 0" {
    run "$CLI_SCRIPT" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve v" ]]
}

@test "-v flag shows version and exits with code 0" {
    run "$CLI_SCRIPT" -v
    [ "$status" -eq 0 ]
    [[ "$output" =~ "claude-evolve v" ]]
}

@test "unknown command shows error and exits with code 1" {
    run "$CLI_SCRIPT" invalid-command
    [ "$status" -eq 1 ]
    [[ "$output" =~ "ERROR" ]]
    [[ "$output" =~ "Unknown command" ]]
}

@test "setup command shows not implemented message and exits with code 1" {
    run "$CLI_SCRIPT" setup
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Setup command not yet implemented" ]]
}

@test "ideate command shows not implemented message and exits with code 1" {
    run "$CLI_SCRIPT" ideate
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Ideate command not yet implemented" ]]
}

@test "run command shows not implemented message and exits with code 1" {
    run "$CLI_SCRIPT" run
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Run command not yet implemented" ]]
}

@test "analyze command shows not implemented message and exits with code 1" {
    run "$CLI_SCRIPT" analyze
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Analyze command not yet implemented" ]]
}