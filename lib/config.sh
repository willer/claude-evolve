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

# Default parallel execution values
DEFAULT_PARALLEL_ENABLED=false
DEFAULT_MAX_WORKERS=4
DEFAULT_LOCK_TIMEOUT=30

# Default auto ideation value
DEFAULT_AUTO_IDEATE=true

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
  
  # Set parallel execution defaults
  PARALLEL_ENABLED="$DEFAULT_PARALLEL_ENABLED"
  MAX_WORKERS="$DEFAULT_MAX_WORKERS"
  LOCK_TIMEOUT="$DEFAULT_LOCK_TIMEOUT"
  
  # Set auto ideation default
  AUTO_IDEATE="$DEFAULT_AUTO_IDEATE"
  
  # Load config if found
  if [[ -f "$config_file" ]]; then
    echo "[INFO] Loading configuration from: $config_file"
    # Simple YAML parsing for key: value pairs and nested structures
    local in_ideation_section=false
    local in_parallel_section=false
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
        continue
      elif [[ $key == "parallel" ]]; then
        in_parallel_section=true
        in_ideation_section=false
        continue
      elif [[ $is_indented == false ]] && [[ $in_ideation_section == true || $in_parallel_section == true ]]; then
        # Non-indented key found while in a section, exit nested sections
        in_ideation_section=false
        in_parallel_section=false
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
        esac
      elif [[ $in_parallel_section == true ]]; then
        # Handle indented keys in parallel section
        case $key in
          enabled) PARALLEL_ENABLED="$value" ;;
          max_workers) MAX_WORKERS="$value" ;;
          lock_timeout) LOCK_TIMEOUT="$value" ;;
        esac
      else
        # Handle top-level keys
        case $key in
          evolution_dir) EVOLUTION_DIR="$value" ;;
          algorithm_file) ALGORITHM_FILE="$value" ;;
          evaluator_file) EVALUATOR_FILE="$value" ;;
          brief_file) BRIEF_FILE="$value" ;;
          evolution_csv) EVOLUTION_CSV="$value" ;;
          output_dir) OUTPUT_DIR="$value" ;;
          parent_selection) PARENT_SELECTION="$value" ;;
          python_cmd) PYTHON_CMD="$value" ;;
          auto_ideate) AUTO_IDEATE="$value" ;;
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
      echo "[INFO] Using evolution directory from config path: $EVOLUTION_DIR"
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
}