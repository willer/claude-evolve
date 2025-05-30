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
DEFAULT_PYTHON_CMD="python3"

# Default ideation strategy values
DEFAULT_TOTAL_IDEAS=15
DEFAULT_NOVEL_EXPLORATION=3
DEFAULT_HILL_CLIMBING=5
DEFAULT_STRUCTURAL_MUTATION=3
DEFAULT_CROSSOVER_HYBRID=4
DEFAULT_NUM_ELITES=3

# Load configuration from config file
load_config() {
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

  # Single config file location: evolution/config.yaml
  local config_file="evolution/config.yaml"
  
  # Load config if found
  if [[ -f "$config_file" ]]; then
    echo "[INFO] Loading configuration from: $config_file"
    # Simple YAML parsing for key: value pairs and nested structures
    local in_ideation_section=false
    while IFS=': ' read -r key value; do
      # Skip comments and empty lines
      [[ $key =~ ^[[:space:]]*# ]] || [[ -z $key ]] && continue
      
      # Remove leading/trailing whitespace
      key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      
      # Remove quotes from value
      value=$(echo "$value" | sed 's/^"//;s/"$//')
      
      # Handle nested ideation_strategies section
      if [[ $key == "ideation_strategies" ]]; then
        in_ideation_section=true
        continue
      elif [[ $key =~ ^[a-z_]+ ]] && [[ $in_ideation_section == true ]]; then
        # Top-level key found, exit ideation section
        in_ideation_section=false
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
        esac
      fi
    done < "$config_file"
  fi

  # Create full paths - ALL paths are relative to evolution_dir
  FULL_EVOLUTION_DIR="$EVOLUTION_DIR"
  FULL_ALGORITHM_PATH="$EVOLUTION_DIR/$ALGORITHM_FILE"
  FULL_EVALUATOR_PATH="$EVOLUTION_DIR/$EVALUATOR_FILE"
  FULL_BRIEF_PATH="$EVOLUTION_DIR/$BRIEF_FILE"
  FULL_CSV_PATH="$EVOLUTION_DIR/$EVOLUTION_CSV"
  
  if [[ -n $OUTPUT_DIR ]]; then
    FULL_OUTPUT_DIR="$EVOLUTION_DIR/$OUTPUT_DIR"
  else
    FULL_OUTPUT_DIR="$EVOLUTION_DIR"
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
    ((errors++))
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
  echo "  Max ideas: $MAX_IDEAS"
  echo "  Python command: $PYTHON_CMD"
}