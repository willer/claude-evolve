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

# Default memory limit (in MB, 0 means no limit)
# Set to reasonable limit for ML workloads - about half of available system RAM
DEFAULT_MEMORY_LIMIT_MB=12288

# Default worker refresh settings
# Workers will exit after processing this many candidates to pick up library updates
DEFAULT_WORKER_MAX_CANDIDATES=3

# Default LLM CLI configuration
DEFAULT_LLM_RUN="glm-zai glm-zai glm-zai glm-zai glm-zai codex-oss-local gemini-flash haiku haiku haiku haiku haiku"
# Ideate: Commercial models for idea generation + local fallback
DEFAULT_LLM_IDEATE="gemini-pro sonnet-think gpt5high glm-openrouter grok-4-openrouter deepseek-openrouter glm-zai"

# Load configuration from a YAML file and update variables
_load_yaml_config() {
  local config_file="$1"
  if [[ ! -f "$config_file" ]]; then
    return 0 # File does not exist, nothing to load
  fi


  local in_ideation_section=false
  local in_parallel_section=false
  local in_llm_cli_section=false
  local llm_cli_subsection=""

  while IFS='' read -r line; do
    [[ $line =~ ^[[:space:]]*# ]] || [[ -z $line ]] && continue

    if [[ ! $line =~ ^([^:]+):(.*)$ ]]; then
      continue
    fi
    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"

    local is_indented=false
    [[ $key =~ ^[[:space:]]+ ]] && is_indented=true

    key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    if [[ "${DEBUG_CONFIG:-}" == "true" ]]; then
      echo "[CONFIG DEBUG] Before comment removal: key='$key' value='$value'" >&2
    fi

    value=$(echo "$value" | sed 's/[[:space:]]*#.*$//')
    value=$(echo "$value" | sed 's/^"//;s/"$//')

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
      in_ideation_section=false
      in_parallel_section=false
      in_llm_cli_section=false
      llm_cli_subsection=""
    fi

    if [[ $in_ideation_section == true ]]; then
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
      case $key in
        enabled) PARALLEL_ENABLED="$value" ;;
        max_workers) MAX_WORKERS="$value" ;;
        lock_timeout) LOCK_TIMEOUT="$value" ;;
      esac
    elif [[ $in_llm_cli_section == true ]]; then
      if [[ $key == "run" || $key == "ideate" ]]; then
        case $key in
          run) LLM_RUN="$value" ;;
          ideate) LLM_IDEATE="$value" ;;
        esac
      else
        value=$(echo "$value" | sed "s/^'//;s/'$//")
        local var_key=$(echo "$key" | sed 's/-/_/g')
        if [[ "${DEBUG_CONFIG:-}" == "true" ]]; then
          echo "[CONFIG DEBUG] Setting LLM_CLI_${var_key} = '$value'" >&2
        fi
        eval "LLM_CLI_${var_key}=\"$value\""
      fi
    else
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
        memory_limit_mb) MEMORY_LIMIT_MB="$value" ;;
        worker_max_candidates) WORKER_MAX_CANDIDATES="$value" ;;
        evolution_dir):
          echo "[WARN] evolution_dir in config is ignored - automatically inferred from config file location" >&2
          ;;
      esac
    fi
  done < "$config_file"
  # Keep track of the last config file loaded to infer evolution_dir
  LAST_CONFIG_FILE_LOADED="$config_file"
}

load_config() {
  # Set defaults first
  EVOLUTION_DIR="$DEFAULT_EVOLUTION_DIR" # Initialize with default
  ALGORITHM_FILE="$DEFAULT_ALGORITHM_FILE"
  EVALUATOR_FILE="$DEFAULT_EVALUATOR_FILE"
  BRIEF_FILE="$DEFAULT_BRIEF_FILE"
  EVOLUTION_CSV="$DEFAULT_EVOLUTION_CSV"
  OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
  PARENT_SELECTION="$DEFAULT_PARENT_SELECTION"
  PYTHON_CMD="$DEFAULT_PYTHON_CMD"

  # Determine EVOLUTION_DIR based on specified logic, overriding default if found
  if [[ -n "$CLAUDE_EVOLVE_WORKING_DIR" ]]; then
    EVOLUTION_DIR="$CLAUDE_EVOLVE_WORKING_DIR"
  elif [[ -f "evolution/evolution.csv" ]]; then
    EVOLUTION_DIR="evolution"
  elif [[ -f "./evolution.csv" ]]; then
    EVOLUTION_DIR="."
  fi

  TOTAL_IDEAS="$DEFAULT_TOTAL_IDEAS"
  NOVEL_EXPLORATION="$DEFAULT_NOVEL_EXPLORATION"
  HILL_CLIMBING="$DEFAULT_HILL_CLIMBING"
  STRUCTURAL_MUTATION="$DEFAULT_STRUCTURAL_MUTATION"
  CROSSOVER_HYBRID="$DEFAULT_CROSSOVER_HYBRID"
  NUM_ELITES="$DEFAULT_NUM_ELITES"
  NUM_REVOLUTION="$DEFAULT_NUM_REVOLUTION"
  
  PARALLEL_ENABLED="$DEFAULT_PARALLEL_ENABLED"
  MAX_WORKERS="$DEFAULT_MAX_WORKERS"
  LOCK_TIMEOUT="$DEFAULT_LOCK_TIMEOUT"
  
  AUTO_IDEATE="$DEFAULT_AUTO_IDEATE"
  MAX_RETRIES="$DEFAULT_MAX_RETRIES"
  MEMORY_LIMIT_MB="$DEFAULT_MEMORY_LIMIT_MB"
  WORKER_MAX_CANDIDATES="$DEFAULT_WORKER_MAX_CANDIDATES"
  
  LLM_RUN="$DEFAULT_LLM_RUN"
  LLM_IDEATE="$DEFAULT_LLM_IDEATE"

  # Determine local config file path relative to EVOLUTION_DIR
  local local_config_file="$EVOLUTION_DIR/config.yaml"

  # Load local config
  _load_yaml_config "$local_config_file"

  # Load global config (overrides local config)
  local global_config_file="$HOME/.config/claude-evolve/config.yaml"
  _load_yaml_config "$global_config_file"
  
  
  # Create full paths - ALL paths are relative to EVOLUTION_DIR
  # Make EVOLUTION_DIR absolute if it\'s relative
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
  echo "  Memory limit: ${MEMORY_LIMIT_MB}MB"
  echo "  Worker max candidates: $WORKER_MAX_CANDIDATES"
  echo "  LLM configuration:"
  # Show LLM configurations using dynamic variable names
  for model in gpt5high o3high codex gemini opus opus_think sonnet sonnet_think cursor_sonnet cursor_opus glm deepseek; do
    var_name="LLM_CLI_${model}"
    var_value=$(eval echo "\$$var_name")
    if [[ -n "$var_value" ]]; then
      # Convert underscore back to dash for display
      display_name=$(echo "$model" | sed 's/_/-/g')
      echo "    $display_name: $var_value"
    fi
  done
  echo "  LLM for run: $LLM_RUN"
  echo "  LLM for ideate: $LLM_IDEATE"
}
