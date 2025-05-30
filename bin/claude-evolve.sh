#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source common functions
# shellcheck source=../lib/common.sh
source "$PROJECT_ROOT/lib/common.sh"

show_version() {
	local version
	version=$(get_package_version "$PROJECT_ROOT/package.json")
	echo "claude-evolve v$version"
}

show_help() {
	cat <<'EOF'
claude-evolve - AI-powered algorithm evolution tool

USAGE:
    claude-evolve [COMMAND] [OPTIONS]

COMMANDS:
    setup       Initialize evolution workspace
    ideate      Generate new algorithm ideas
    run         Execute evolution candidates
    analyze     Analyze evolution results
    help        Show this help message

OPTIONS:
    -h, --help     Show help message
    -v, --version  Show version

EXAMPLES:
    claude-evolve setup
    claude-evolve ideate 5
    claude-evolve run --parallel 2
    claude-evolve analyze --open

For more information, visit: https://github.com/anthropics/claude-evolve
EOF
}

show_interactive_menu() {
	echo "=== Claude Evolve Interactive Menu ==="
	echo
	echo "Select a command:"
	echo "1) setup    - Initialize evolution workspace"
	echo "2) ideate   - Generate new algorithm ideas"
	echo "3) run      - Execute evolution candidates"
	echo "4) analyze  - Analyze evolution results"
	echo "5) help     - Show help message"
	echo "6) exit     - Exit"
	echo
	read -r -p "Enter your choice (1-6): " choice

	case $choice in
	1) cmd_setup ;;
	2) cmd_ideate ;;
	3) cmd_run ;;
	4) cmd_analyze ;;
	5) show_help ;;
	6)
		echo "Goodbye!"
		exit 0
		;;
	*)
		log_error "Invalid choice. Please select 1-6."
		exit 1
		;;
	esac
}

# Command implementations (stubs for now)
cmd_setup() {
	log_info "Setup command not yet implemented"
	exit 1
}

cmd_ideate() {
	log_info "Ideate command not yet implemented"
	exit 1
}

cmd_run() {
	log_info "Run command not yet implemented"
	exit 1
}

cmd_analyze() {
	log_info "Analyze command not yet implemented"
	exit 1
}

# Main argument parsing
main() {
	if [[ $# -eq 0 ]]; then
		show_interactive_menu
		return
	fi

	case "${1:-}" in
	-h | --help | help)
		show_help
		;;
	-v | --version)
		show_version
		;;
	setup)
		shift
		cmd_setup "$@"
		;;
	ideate)
		shift
		cmd_ideate "$@"
		;;
	run)
		shift
		cmd_run "$@"
		;;
	analyze)
		shift
		cmd_analyze "$@"
		;;
	*)
		log_error "Unknown command: ${1:-}"
		echo
		show_help
		exit 1
		;;
	esac
}

# Only run main if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	main "$@"
fi
