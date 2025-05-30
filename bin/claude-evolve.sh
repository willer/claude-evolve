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
    claude-evolve run --timeout 300
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

# Command implementations
cmd_setup() {
  log_info "Initializing evolution workspace..."

  local evo_dir="./evolution"

  # Create evolution directory if it doesn't exist
  if [[ ! -d $evo_dir ]]; then
    log_info "Creating evolution/ directory..."
    mkdir -p "$evo_dir" || {
      log_error "Failed to create $evo_dir"
      exit 1
    }
  else
    log_info "evolution/ directory already exists"
  fi

  # Copy template files if they don't exist
  local template_files=("BRIEF.md" "algorithm.py" "evaluator.py")
  local copied_files=()

  for file in "${template_files[@]}"; do
    local src="$PROJECT_ROOT/templates/$file"
    local dest="$evo_dir/$file"
    if [[ ! -f $dest ]]; then
      if [[ -f $src ]]; then
        log_info "Copying $file from templates..."
        cp "$src" "$dest" || {
          log_error "Failed to copy $file"
          exit 1
        }
        copied_files+=("$file")
      else
        log_error "Template file $src not found"
        exit 1
      fi
    else
      log_info "$file already exists, skipping"
    fi
  done

  # Create evolution.csv with header if it doesn't exist
  local csv_file="$evo_dir/evolution.csv"
  if [[ ! -f $csv_file ]]; then
    log_info "Creating evolution.csv with header..."
    echo "id,basedOnId,description,performance,status" >"$csv_file" || {
      log_error "Failed to create evolution.csv"
      exit 1
    }
  else
    log_info "evolution.csv already exists, skipping"
  fi

  # Open editor for BRIEF.md in interactive mode if templates were copied or file is empty
  local brief_file="$evo_dir/BRIEF.md"
  if [[ ${#copied_files[@]} -gt 0 ]] || [[ ! -s $brief_file ]]; then
    if [[ -t 1 ]]; then
      log_info "Opening BRIEF.md for editing..."
      local editor="${EDITOR:-nano}"
      if command -v "$editor" >/dev/null 2>&1; then
        "$editor" "$brief_file" || {
          log_warn "Editor exited with non-zero status, but continuing..."
        }
      else
        log_warn "Editor '$editor' not found. Please edit $brief_file manually."
      fi
    else
      log_info "Skipping editor: not running in an interactive terminal"
    fi
  else
    log_info "BRIEF.md already exists and has content, skipping editor"
  fi

  log_info "Evolution workspace setup complete!"
  log_info "Next steps:"
  log_info "  1. Edit evolution/BRIEF.md to describe your optimization problem"
  log_info "  2. Customize evolution/evaluator.py for your evaluation criteria"
  log_info "  3. Run 'claude-evolve ideate' to generate initial candidates"
}

cmd_ideate() {
  local count=1
  local no_ai=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
    --help)
      echo "claude-evolve ideate - Generate new algorithm ideas"
      echo ""
      echo "USAGE:"
      echo "  claude-evolve ideate [N] [--no-ai]"
      echo ""
      echo "ARGUMENTS:"
      echo "  N         Number of ideas to generate (default: 1, max: 50)"
      echo ""
      echo "OPTIONS:"
      echo "  --no-ai   Use manual entry mode instead of AI generation"
      echo "  --help    Show this help message"
      echo ""
      echo "DESCRIPTION:"
      echo "  Generates new algorithm variations by prompting Claude with context"
      echo "  from the project BRIEF.md and top performers from evolution.csv."
      echo "  Falls back to manual entry if --no-ai is specified or Claude fails."
      return 0
      ;;
    --no-ai)
      no_ai=true
      shift
      ;;
    *)
      # Check if it's a number
      if [[ $1 =~ ^[0-9]+$ ]]; then
        count=$1
      else
        log_error "Invalid number of ideas: $1"
        exit 1
      fi
      shift
      ;;
    esac
  done

  # Validate count range
  if [[ $count -lt 1 || $count -gt 50 ]]; then
    log_error "Number of ideas must be between 1 and 50"
    exit 1
  fi

  # Check for evolution workspace in current directory
  local evo_dir="./evolution"
  if [[ ! -d $evo_dir ]]; then
    log_error "Evolution workspace not found. Run 'claude-evolve setup' first."
    exit 1
  fi

  local csv_file="$evo_dir/evolution.csv"
  local brief_file="$evo_dir/BRIEF.md"

  # Ensure CSV file has header if it doesn't exist
  if [[ ! -f $csv_file ]]; then
    echo "id,basedOnId,description,performance,status" >"$csv_file"
  fi

  if [[ $no_ai == "true" ]]; then
    log_info "Manual entry mode"
    ideate_manual "$count" "$csv_file"
  else
    # Try AI generation first, fall back to manual on failure
    if ! ideate_ai "$count" "$csv_file" "$brief_file"; then
      log_warning "AI generation failed, falling back to manual entry"
      ideate_manual "$count" "$csv_file"
    fi
  fi
}

# Manual idea entry function
ideate_manual() {
  local count="$1"
  local csv_file="$2"
  local ideas_added=0

  for ((i = 1; i <= count; i++)); do
    if [[ $count -eq 1 ]]; then
      read -r -p "Enter algorithm idea (or empty to skip): " description
    else
      read -r -p "Enter algorithm idea $i/$count (or empty to skip): " description
    fi

    # Skip empty descriptions
    if [[ -z $description ]]; then
      log_info "Empty description, skipping idea"
      continue
    fi

    # Add to CSV
    local id
    id=$(add_idea_to_csv "$csv_file" "$description")
    log_info "Added idea: $description"
    ((ideas_added++))

    # Ask to continue for multi-idea mode
    if [[ $i -lt $count ]]; then
      read -r -p "Add another idea? (y/N) " continue_adding
      if [[ $continue_adding != "y" && $continue_adding != "Y" ]]; then
        break
      fi
    fi
  done

  if [[ $ideas_added -eq 0 ]]; then
    log_info "No ideas generated"
  else
    log_info "Added $ideas_added idea(s) to evolution.csv"
  fi
}

# AI-powered idea generation function
ideate_ai() {
  local count="$1"
  local csv_file="$2"
  local brief_file="$3"

  # Check if claude CLI is available
  if ! command -v claude >/dev/null 2>&1; then
    log_warning "Claude CLI not found. Please install it or use --no-ai flag."
    return 1
  fi

  # Check if BRIEF.md exists
  if [[ ! -f $brief_file ]]; then
    log_warning "BRIEF.md not found. Please create it first to provide context for AI generation."
    return 1
  fi

  # Build the prompt
  local prompt
  prompt="You are helping with algorithm evolution. Generate exactly $count new algorithm idea(s) based on the following context.

Project Brief:
$(cat "$brief_file")
"

  # Add top performers if they exist
  local top_performers
  top_performers=$(get_top_performers "$csv_file" 5)
  if [[ -n $top_performers ]]; then
    prompt="$prompt
Top Performing Algorithms So Far:
$top_performers
"
  fi

  prompt="$prompt
Generate $count creative algorithm variation(s) that could potentially improve performance.
For each idea, provide a single line description that explains the approach.
Format: One idea per line, no numbering, no extra formatting."

  # Call Claude API
  log_info "Generating $count idea(s) with Claude..."
  local response
  if ! response=$(echo "$prompt" | claude -p 2>&1); then
    log_warning "Claude API call failed: $response"
    return 1
  fi

  # Process response and add ideas to CSV
  local ideas_added=0
  while IFS= read -r line; do
    # Skip empty lines
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [[ -z $line ]]; then
      continue
    fi

    # Skip lines that look like formatting
    if [[ $line =~ ^[0-9]+\. ]] || [[ $line =~ ^- ]] || [[ $line =~ ^\* ]]; then
      # Remove the numbering/bullet and process the rest
      line=$(echo "$line" | sed 's/^[0-9]*\. *//;s/^[-*] *//')
    fi

    # Add to CSV
    local id
    id=$(add_idea_to_csv "$csv_file" "$line")
    log_info "Added idea: $line"
    ((ideas_added++))

    # Stop if we have enough ideas
    if [[ $ideas_added -ge $count ]]; then
      break
    fi
  done <<<"$response"

  if [[ $ideas_added -eq 0 ]]; then
    log_warning "No valid ideas extracted from Claude response"
    return 1
  fi

  log_info "Successfully generated $ideas_added idea(s)"
  return 0
}

cmd_run() {
  local timeout_seconds=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
    --timeout)
      if [[ -z ${2:-} ]] || [[ ! $2 =~ ^[0-9]+$ ]]; then
        log_error "--timeout requires a positive integer (seconds)"
        exit 1
      fi
      if [[ $2 -eq 0 ]]; then
        log_error "Timeout must be greater than 0 seconds"
        exit 1
      fi
      timeout_seconds="$2"
      shift 2
      ;;
    --help)
      echo "claude-evolve run - Execute evolution candidates"
      echo ""
      echo "USAGE:"
      echo "  claude-evolve run [OPTIONS]"
      echo ""
      echo "OPTIONS:"
      echo "  --timeout <sec>  Kill evaluator after specified seconds (default: no timeout)"
      echo "  --help           Show this help message"
      echo ""
      echo "DESCRIPTION:"
      echo "  Processes the oldest pending candidate from evolution.csv by:"
      echo "  1. Generating algorithm mutation using Claude"
      echo "  2. Running evaluator.py on the generated algorithm"
      echo "  3. Updating CSV with performance score and completion status"
      echo ""
      echo "  Use --timeout to prevent runaway evaluations from blocking progress."
      return 0
      ;;
    *)
      log_error "Unknown option: $1"
      log_error "Use 'claude-evolve run --help' for usage information"
      exit 1
      ;;
    esac
  done

  log_info "Starting evolution run..."
  if [[ -n $timeout_seconds ]]; then
    log_info "Using timeout: ${timeout_seconds} seconds"
  fi

  local evo_dir="./evolution"
  local csv_file="$evo_dir/evolution.csv"
  local evaluator_script="$evo_dir/evaluator.py"

  # Validate required files exist
  if [[ ! -d $evo_dir ]]; then
    log_error "Evolution directory not found. Run 'claude-evolve setup' first."
    exit 1
  fi

  if [[ ! -f $csv_file ]]; then
    log_error "evolution.csv not found. Run 'claude-evolve setup' first."
    exit 1
  fi

  if [[ ! -f $evaluator_script ]]; then
    log_error "evaluator.py not found. Run 'claude-evolve setup' first."
    exit 1
  fi

  # Ensure jq is available for JSON parsing
  require_command jq

  # Find oldest empty row to process
  local row_num
  if ! row_num=$(find_oldest_empty_row "$csv_file"); then
    log_error "No empty rows found in CSV. Run 'claude-evolve ideate' to add candidates."
    exit 1
  fi

  # Get row data
  local row_data
  row_data=$(get_csv_row "$csv_file" "$row_num")

  # Parse tab-separated values using cut for precise field extraction
  local id=$(echo "$row_data" | cut -f1)
  local based_on_id=$(echo "$row_data" | cut -f2)
  local description=$(echo "$row_data" | cut -f3)
  local performance=$(echo "$row_data" | cut -f4)
  local row_status=$(echo "$row_data" | cut -f5)

  # Remove quotes from description if present
  description=${description#\"}
  description=${description%\"}

  log_info "Processing candidate ID: $id"
  log_info "Description: $description"
  log_info "Based on ID: $based_on_id"

  # Set up interrupt handler to mark interrupted status
  trap 'update_csv_row "$csv_file" "$row_num" "" "interrupted"; log_info "Evolution interrupted"; exit 130' INT

  # Mark as in progress
  update_csv_row "$csv_file" "$row_num" "" "running"

  # Determine parent algorithm file
  local parent_file="$evo_dir/algorithm.py"
  if [[ $based_on_id != "" && $based_on_id != "0" ]]; then
    parent_file="$evo_dir/evolution_id${based_on_id}.py"
    if [[ ! -f $parent_file ]]; then
      log_error "Parent algorithm file not found: $parent_file"
      update_csv_row "$csv_file" "$row_num" "" "failed"
      exit 1
    fi
  fi

  log_info "Using parent algorithm: $parent_file"

  # Generate mutated algorithm using Claude
  local output_file="$evo_dir/evolution_id${id}.py"
  if ! generate_algorithm_mutation "$parent_file" "$output_file" "$description" "$evo_dir/BRIEF.md"; then
    log_error "Failed to generate algorithm mutation"
    update_csv_row "$csv_file" "$row_num" "" "failed"
    exit 1
  fi

  log_info "Generated algorithm: $output_file"

  # Run evaluator on the new algorithm
  log_info "Running evaluation..."
  local eval_output
  local eval_exit_code

  # Run evaluator with optional timeout
  if [[ -n $timeout_seconds ]]; then
    log_info "Starting evaluation with ${timeout_seconds}s timeout..."
    if eval_output=$(timeout "$timeout_seconds" python3 "$evaluator_script" "$output_file" 2>&1); then
      eval_exit_code=0
    else
      eval_exit_code=$?
      # Check if timeout occurred (exit code 124 from timeout command)
      if [[ $eval_exit_code -eq 124 ]]; then
        log_error "Evaluation timed out after ${timeout_seconds} seconds"
        update_csv_row "$csv_file" "$row_num" "" "timeout"
        exit 1
      fi
    fi
  else
    if eval_output=$(python3 "$evaluator_script" "$output_file" 2>&1); then
      eval_exit_code=0
    else
      eval_exit_code=$?
    fi
  fi

  if [[ $eval_exit_code -eq 0 ]]; then
    # Parse performance metric from JSON output
    local performance_score
    if performance_score=$(echo "$eval_output" | jq -r '.score // .performance // empty' 2>/dev/null); then
      if [[ -n $performance_score && $performance_score != "null" ]]; then
        update_csv_row "$csv_file" "$row_num" "$performance_score" "completed"
        log_info "✓ Evaluation completed successfully"
        log_info "Performance score: $performance_score"
      else
        log_error "Invalid evaluator output format - no score found"
        log_error "Evaluator output: $eval_output"
        update_csv_row "$csv_file" "$row_num" "" "failed"
        exit 1
      fi
    else
      log_error "Failed to parse evaluator JSON output"
      log_error "Evaluator output: $eval_output"
      update_csv_row "$csv_file" "$row_num" "" "failed"
      exit 1
    fi
  else
    log_error "Evaluator failed with exit code $eval_exit_code"
    log_error "Evaluator output: $eval_output"
    update_csv_row "$csv_file" "$row_num" "" "failed"
    exit 1
  fi

  log_info "Evolution cycle completed successfully!"
}

# Generate algorithm mutation using Claude
generate_algorithm_mutation() {
  local parent_file="$1"
  local output_file="$2"
  local description="$3"
  local brief_file="$4"

  # Check if claude command is available (allow CLAUDE_CMD override for testing)
  local claude_cmd="${CLAUDE_CMD:-claude}"
  if ! command -v "$claude_cmd" >/dev/null 2>&1; then
    log_error "Claude CLI not found: $claude_cmd. Please install claude-cli and authenticate."
    log_error "For testing, you can set CLAUDE_CMD environment variable to a mock script."
    return 1
  fi

  # Read parent algorithm
  local parent_code
  if ! parent_code=$(cat "$parent_file"); then
    log_error "Failed to read parent algorithm file: $parent_file"
    return 1
  fi

  # Read brief for context
  local brief_content=""
  if [[ -f $brief_file ]]; then
    brief_content=$(cat "$brief_file" 2>/dev/null || echo "")
  fi

  # Create mutation prompt
  local prompt
  prompt=$(
    cat <<EOF
You are an AI assistant helping to evolve algorithms through mutations. Please create a new Python algorithm based on the parent algorithm and the requested modification.

CONTEXT:
$brief_content

PARENT ALGORITHM:
\`\`\`python
$parent_code
\`\`\`

REQUESTED MODIFICATION:
$description

INSTRUCTIONS:
1. Study the parent algorithm carefully
2. Apply the requested modification while preserving the core structure
3. Ensure the modified algorithm maintains the same interface (function signatures)
4. Include proper error handling and documentation
5. Return ONLY the complete Python code without explanation

The output should be a complete, executable Python file that builds upon the parent algorithm.
EOF
  )

  log_info "Requesting algorithm mutation from Claude..."

  # Generate mutation using Claude
  local generated_code
  if generated_code=$(echo "$prompt" | "$claude_cmd"); then
    # Save generated algorithm
    if echo "$generated_code" >"$output_file"; then
      log_info "Algorithm mutation saved to: $output_file"
      return 0
    else
      log_error "Failed to save generated algorithm"
      return 1
    fi
  else
    log_error "Claude failed to generate algorithm mutation"
    return 1
  fi
}

cmd_analyze() {
  node "$(dirname "$0")/analyze.js" "$@"
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
if [[ ${BASH_SOURCE[0]} == "${0}" ]]; then
  main "$@"
fi
