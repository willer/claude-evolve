#!/bin/bash
# Configuration loader for claude-evolve

# Default configuration values
DEFAULT_EVOLUTION_DIR="evolution"
DEFAULT_ALGORITHM_FILE="algorithm.py"
DEFAULT_EVALUATOR_FILE="evaluator.py"
DEFAULT_BRIEF_FILE="BRIEF.md"
DEFAULT_EVOLUTION_CSV="evolution.csv"
DEFAULT_OUTPUT_DIR=""
DEFAULT_PARENT_SELECTION="best"
# Detect Python command based on platform
detect_python_cmd() {
  # Try python3 first (macOS, Linux)
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
  # Try python (Windows, some Linux)
  elif command -v python >/dev/null 2>&1; then
    # Verify it's Python 3
    if python -c "import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)" 2>/dev/null; then
      echo "python"
    else
      echo "python3"  # Fallback
    fi
  else
    echo "python3"  # Default fallback
  fi
}

DEFAULT_PYTHON_CMD="$(detect_python_cmd)"

# Default ideation strategy values
DEFAULT_TOTAL_IDEAS=15
DEFAULT_NOVEL_EXPLORATION=3
DEFAULT_HILL_CLIMBING=5
DEFAULT_STRUCTURAL_MUTATION=3
DEFAULT_CROSSOVER_HYBRID=4
DEFAULT_NUM_ELITES=3
DEFAULT_NUM_REVOLUTION=2  # Number of top novel candidates to include

# Default parallel execution values
DEFAULT_PARALLEL_ENABLED=false
DEFAULT_MAX_WORKERS=4
DEFAULT_LOCK_TIMEOUT=10

# Default auto ideation value
DEFAULT_AUTO_IDEATE=true

# Default retry value
DEFAULT_MAX_RETRIES=3

# Default LLM CLI configuration (using eval for compatibility)
declare -a DEFAULT_LLM_CLI_KEYS
declare -a DEFAULT_LLM_CLI_VALUES
DEFAULT_LLM_CLI_KEYS=(o3 codex gemini opus sonnet)
DEFAULT_LLM_CLI_VALUES[0]='codex exec -m o3 --dangerously-bypass-approvals-and-sandbox "$PROMPT"'
DEFAULT_LLM_CLI_VALUES[1]='codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT"'
DEFAULT_LLM_CLI_VALUES[2]='gemini -y -p "$PROMPT"'
DEFAULT_LLM_CLI_VALUES[3]='claude --dangerously-skip-permissions --model opus -p "$PROMPT"'
DEFAULT_LLM_CLI_VALUES[4]='claude --dangerously-skip-permissions --model sonnet -p "$PROMPT"'
DEFAULT_LLM_RUN="sonnet gemini codex"
DEFAULT_LLM_IDEATE="opus gemini o3"

# Load configuration from config file
load_config() {
  # Accept config file path as parameter
  local config_file="${1:-evolution/config.yaml}"
  
  # Set defaults first
  EVOLUTION_DIR="$DEFAULT_EVOLUTION_DIR"
  ALGORITHM_FILE="$DEFAULT_ALGORITHM_FILE"
  EVALUATOR_FILE="$DEFAULT_EVALUATOR_FILE"
  BRIEF_FILE="$DEFAULT_BRIEF_FILE"
  EVOLUTION_CSV="$DEFAULT_EVOLUTION_CSV"
  OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
  PARENT_SELECTION="$DEFAULT_PARENT_SELECTION"
  PYTHON_CMD="$DEFAULT_PYTHON_CMD"
  
  # Set ideation strategy defaults
  TOTAL_IDEAS="$DEFAULT_TOTAL_IDEAS"
  NOVEL_EXPLORATION="$DEFAULT_NOVEL_EXPLORATION"
  HILL_CLIMBING="$DEFAULT_HILL_CLIMBING"
  STRUCTURAL_MUTATION="$DEFAULT_STRUCTURAL_MUTATION"
  CROSSOVER_HYBRID="$DEFAULT_CROSSOVER_HYBRID"
  NUM_ELITES="$DEFAULT_NUM_ELITES"
  NUM_REVOLUTION="$DEFAULT_NUM_REVOLUTION"
  
  # Set parallel execution defaults
  PARALLEL_ENABLED="$DEFAULT_PARALLEL_ENABLED"
  MAX_WORKERS="$DEFAULT_MAX_WORKERS"
  LOCK_TIMEOUT="$DEFAULT_LOCK_TIMEOUT"
  
  # Set auto ideation default
  AUTO_IDEATE="$DEFAULT_AUTO_IDEATE"
  
  # Set retry default
  MAX_RETRIES="$DEFAULT_MAX_RETRIES"
  
  # Set LLM CLI defaults (compatibility for older bash)
  # Initialize associative array for LLM commands
  # Use simpler approach for compatibility
  LLM_CLI_o3='codex exec -m o3 --dangerously-bypass-approvals-and-sandbox "$PROMPT"'
  LLM_CLI_codex='codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT"'
  LLM_CLI_gemini='gemini -y -p "$PROMPT"'
  LLM_CLI_opus='claude --dangerously-skip-permissions --model opus -p "$PROMPT"'
  LLM_CLI_sonnet='claude --dangerously-skip-permissions --model sonnet -p "$PROMPT"'
  LLM_RUN="$DEFAULT_LLM_RUN"
  LLM_IDEATE="$DEFAULT_LLM_IDEATE"
  
  # Load config if found
  if [[ -f "$config_file" ]]; then
    echo "[DEBUG] Loading configuration from: $config_file" >&2
    # Simple YAML parsing for key: value pairs and nested structures
    local in_ideation_section=false
    local in_parallel_section=false
    local in_llm_cli_section=false
    local llm_cli_subsection=""
    while IFS='' read -r line; do
      # Skip comments and empty lines
      [[ $line =~ ^[[:space:]]*# ]] || [[ -z $line ]] && continue
      
      # Parse key:value from line
      if [[ ! $line =~ ^([^:]+):(.*)$ ]]; then
        continue
      fi
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      
      # Check if key is indented (for nested sections)
      local is_indented=false
      [[ $key =~ ^[[:space:]]+ ]] && is_indented=true
      
      
      # Remove leading/trailing whitespace
      key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      
      # Remove inline comments from value
      value=$(echo "$value" | sed 's/[[:space:]]*#.*$//')
      
      # Remove quotes from value
      value=$(echo "$value" | sed 's/^"//;s/"$//')
      
      # Handle nested sections
      if [[ $key == "ideation_strategies" ]]; then
        in_ideation_section=true
        in_parallel_section=false
        in_llm_cli_section=false
        continue
      elif [[ $key == "parallel" ]]; then
        in_parallel_section=true
        in_ideation_section=false
        in_llm_cli_section=false
        continue
      elif [[ $key == "llm_cli" ]]; then
        in_llm_cli_section=true
        in_ideation_section=false
        in_parallel_section=false
        llm_cli_subsection=""
        continue
      elif [[ $is_indented == false ]] && [[ $in_ideation_section == true || $in_parallel_section == true || $in_llm_cli_section == true ]]; then
        # Non-indented key found while in a section, exit nested sections
        in_ideation_section=false
        in_parallel_section=false
        in_llm_cli_section=false
        llm_cli_subsection=""
      fi
      
      if [[ $in_ideation_section == true ]]; then
        # Handle indented keys in ideation_strategies
        case $key in
          total_ideas) TOTAL_IDEAS="$value" ;;
          novel_exploration) NOVEL_EXPLORATION="$value" ;;
          hill_climbing) HILL_CLIMBING="$value" ;;
          structural_mutation) STRUCTURAL_MUTATION="$value" ;;
          crossover_hybrid) CROSSOVER_HYBRID="$value" ;;
          num_elites) NUM_ELITES="$value" ;;
          num_revolution) NUM_REVOLUTION="$value" ;;
        esac
      elif [[ $in_parallel_section == true ]]; then
        # Handle indented keys in parallel section
        case $key in
          enabled) PARALLEL_ENABLED="$value" ;;
          max_workers) MAX_WORKERS="$value" ;;
          lock_timeout) LOCK_TIMEOUT="$value" ;;
        esac
      elif [[ $in_llm_cli_section == true ]]; then
        # Handle indented keys in llm_cli section
        # Check if this is a model definition (o3, codex, gemini, etc.) or a command list (run, ideate)
        if [[ $key == "run" || $key == "ideate" ]]; then
          # Command list - value is a space-separated list of models
          case $key in
            run) LLM_RUN="$value" ;;
            ideate) LLM_IDEATE="$value" ;;
          esac
        else
          # Model definition - key is model name, value is command template
          # Remove single quotes from value if present
          value=$(echo "$value" | sed "s/^'//;s/'$//")
          # Use dynamic variable name for compatibility
          eval "LLM_CLI_${key}=\"$value\""
        fi
      else
        # Handle top-level keys
        case $key in
          algorithm_file) ALGORITHM_FILE="$value" ;;
          evaluator_file) EVALUATOR_FILE="$value" ;;
          brief_file) BRIEF_FILE="$value" ;;
          evolution_csv) EVOLUTION_CSV="$value" ;;
          output_dir) OUTPUT_DIR="$value" ;;
          parent_selection) PARENT_SELECTION="$value" ;;
          python_cmd) PYTHON_CMD="$value" ;;
          auto_ideate) AUTO_IDEATE="$value" ;;
          max_retries) MAX_RETRIES="$value" ;;
          evolution_dir) 
            echo "[WARN] evolution_dir in config is ignored - automatically inferred from config file location" >&2
            ;;
        esac
      fi
    done < "$config_file"
  fi

  # If config file is in a different directory, use that as the evolution dir
  if [[ "$config_file" != "evolution/config.yaml" ]]; then
    # Extract directory from config file path
    local config_dir=$(dirname "$config_file")
    if [[ "$config_dir" != "." && "$config_dir" != "" ]]; then
      EVOLUTION_DIR="$config_dir"
      echo "[DEBUG] Using evolution directory from config path: $EVOLUTION_DIR" >&2
    fi
  fi
  
  # Create full paths - ALL paths are relative to evolution_dir
  # Make evolution_dir absolute if it's relative
  if [[ "$EVOLUTION_DIR" = /* ]]; then
    FULL_EVOLUTION_DIR="$EVOLUTION_DIR"
  else
    FULL_EVOLUTION_DIR="$(cd "$EVOLUTION_DIR" 2>/dev/null && pwd)" || FULL_EVOLUTION_DIR="$EVOLUTION_DIR"
  fi
  
  FULL_ALGORITHM_PATH="$FULL_EVOLUTION_DIR/$ALGORITHM_FILE"
  FULL_EVALUATOR_PATH="$FULL_EVOLUTION_DIR/$EVALUATOR_FILE"
  FULL_BRIEF_PATH="$FULL_EVOLUTION_DIR/$BRIEF_FILE"
  FULL_CSV_PATH="$FULL_EVOLUTION_DIR/$EVOLUTION_CSV"
  
  if [[ -n $OUTPUT_DIR ]]; then
    FULL_OUTPUT_DIR="$FULL_EVOLUTION_DIR/$OUTPUT_DIR"
  else
    FULL_OUTPUT_DIR="$FULL_EVOLUTION_DIR"
  fi
}

# Validate configuration
validate_config() {
  local errors=0

  if [[ ! -d "$FULL_EVOLUTION_DIR" ]]; then
    echo "[ERROR] Evolution directory not found: $FULL_EVOLUTION_DIR" >&2
    ((errors++))
  fi

  if [[ ! -f "$FULL_ALGORITHM_PATH" ]]; then
    echo "[ERROR] Algorithm file not found: $FULL_ALGORITHM_PATH" >&2
    ((errors++))
  fi

  if [[ ! -f "$FULL_EVALUATOR_PATH" ]]; then
    echo "[ERROR] Evaluator file not found: $FULL_EVALUATOR_PATH" >&2
    ((errors++))
  fi

  if [[ ! -f "$FULL_BRIEF_PATH" ]]; then
    echo "[ERROR] Brief file not found: $FULL_BRIEF_PATH" >&2
    ((errors++))
  fi

  if ! command -v "$PYTHON_CMD" >/dev/null 2>&1; then
    echo "[ERROR] Python command not found: $PYTHON_CMD" >&2
    echo "[ERROR] Please install Python 3.x or set python_cmd in config.yaml" >&2
    echo "[ERROR] Examples: python_cmd: \"python\" or python_cmd: \"C:\\Python39\\python.exe\"" >&2
    ((errors++))
  else
    # Verify Python version is 3.x
    if ! "$PYTHON_CMD" -c "import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)" 2>/dev/null; then
      echo "[ERROR] Python 3.x required, but $PYTHON_CMD appears to be Python 2" >&2
      echo "[ERROR] Please set python_cmd in config.yaml to point to Python 3" >&2
      ((errors++))
    fi
  fi

  return $errors
}

# Show current configuration
show_config() {
  echo "Current claude-evolve configuration:"
  echo "  Evolution directory: $FULL_EVOLUTION_DIR"
  echo "  Algorithm file: $FULL_ALGORITHM_PATH"
  echo "  Evaluator file: $FULL_EVALUATOR_PATH"
  echo "  Brief file: $FULL_BRIEF_PATH"
  echo "  CSV file: $FULL_CSV_PATH"
  echo "  Output directory: $FULL_OUTPUT_DIR"
  echo "  Parent selection: $PARENT_SELECTION"
  echo "  Python command: $PYTHON_CMD"
  echo "  Parallel enabled: $PARALLEL_ENABLED"
  echo "  Max workers: $MAX_WORKERS"
  echo "  Lock timeout: $LOCK_TIMEOUT"
  echo "  Auto ideate: $AUTO_IDEATE"
  echo "  Max retries: $MAX_RETRIES"
  echo "  LLM configuration:"
  # Show LLM configurations using dynamic variable names
  for model in o3 codex gemini opus sonnet; do
    var_name="LLM_CLI_${model}"
    if [[ -n "${!var_name}" ]]; then
      echo "    $model: ${!var_name}"
    fi
  done
  echo "  LLM for run: $LLM_RUN"
  echo "  LLM for ideate: $LLM_IDEATE"
}