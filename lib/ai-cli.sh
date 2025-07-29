#!/bin/bash
# Centralized AI CLI invocation library for claude-evolve

# Source config to get LLM_CLI array and model lists
# This will be sourced after config.sh in the main scripts

# Call an AI model using the configured command template
# Usage: call_ai_model_configured <model_name> <prompt>
# Returns: 0 on success, non-zero on failure
# Output: AI response on stdout
call_ai_model_configured() {
  local model_name="$1"
  local prompt="$2"
  
  # Get command template using dynamic variable name for compatibility
  local var_name="LLM_CLI_${model_name}"
  local cmd_template="${!var_name}"
  
  # Check if model is configured
  if [[ -z "$cmd_template" ]]; then
    echo "[ERROR] Model '$model_name' not configured in llm_cli section" >&2
    return 1
  fi
  
  # Replace $PROMPT with actual prompt (properly escaped)
  # Use bash variable substitution to avoid issues with special characters
  local cmd="${cmd_template//\$PROMPT/$prompt}"
  
  # Execute the command with timeout
  local ai_output
  ai_output=$(timeout 300 bash -c "$cmd" 2>&1)
  local ai_exit_code=$?
  
  # Output the result
  echo "$ai_output"
  return $ai_exit_code
}

# Check if AI output indicates a usage limit was hit
is_usage_limit_error() {
  local output="$1"
  local model_name="$2"
  
  # Generic patterns that work across models
  echo "$output" | grep -qE "usage limit|rate limit|quota|429|Too Many Requests|Claude AI usage limit reached"
}

# Validate if AI output is successful
is_valid_ai_output() {
  local output="$1"
  local exit_code="$2"
  
  # First check exit code
  [[ $exit_code -ne 0 ]] && return 1
  
  # Check for minimal output
  [[ -z "$output" ]] && return 1
  
  # Check for common error patterns
  if echo "$output" | grep -qi "error\|failed\|exception" && ! echo "$output" | grep -qi "error handling\|error recovery"; then
    return 1
  fi
  
  return 0
}

# Clean AI output if needed (e.g., extract from JSON)
clean_ai_output() {
  local output="$1"
  local model_name="$2"
  
  # Handle codex-specific output format
  if [[ "$model_name" == "codex" || "$model_name" == "o3" ]]; then
    # Clean codex output - extract content between "codex" marker and "tokens used"
    if echo "$output" | grep -q "^\[.*\] codex$"; then
      # Extract content between "codex" line and "tokens used" line
      output=$(echo "$output" | awk '/\] codex$/{flag=1;next}/\] tokens used/{flag=0}flag')
    fi
  fi
  
  # Trim whitespace
  output=$(echo "$output" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  
  echo "$output"
}

# Get models for a specific command (run or ideate)
# Usage: get_models_for_command <command>
# Returns: Array of model names
get_models_for_command() {
  local command="$1"
  local model_list=""
  
  case "$command" in
    run)
      model_list="$LLM_RUN"
      ;;
    ideate)
      model_list="$LLM_IDEATE"
      ;;
    *)
      echo "[ERROR] Unknown command: $command" >&2
      return 1
      ;;
  esac
  
  # Convert space-separated list to array
  echo "$model_list"
}

# Call AI with round-robin and fallback support
# Usage: call_ai_with_round_robin <prompt> <command> <hash_value>
# command: "run" or "ideate"
# hash_value: numeric value for round-robin selection (e.g., candidate ID hash)
call_ai_with_round_robin() {
  local prompt="$1"
  local command="$2"
  local hash_value="${3:-0}"
  
  # Get model list for this command
  local model_list
  model_list=$(get_models_for_command "$command")
  if [[ -z "$model_list" ]]; then
    echo "[ERROR] No models configured for command: $command" >&2
    return 1
  fi
  
  # Convert to array
  local models=()
  read -ra models <<< "$model_list"
  
  if [[ ${#models[@]} -eq 0 ]]; then
    echo "[ERROR] No models available for $command" >&2
    return 1
  fi
  
  # Calculate starting index for round-robin
  local num_models=${#models[@]}
  local start_index=$((hash_value % num_models))
  
  # Create ordered list based on round-robin
  local ordered_models=()
  for ((i=0; i<num_models; i++)); do
    local idx=$(((start_index + i) % num_models))
    ordered_models+=("${models[$idx]}")
  done
  
  echo "[AI] Model order for $command (round-robin): ${ordered_models[*]}" >&2
  
  # Track models that hit usage limits
  local limited_models=()
  local tried_models=()
  
  # Try each model in order
  for model in "${ordered_models[@]}"; do
    echo "[AI] Attempting $command with $model" >&2
    tried_models+=("$model")
    
    # Call the AI model
    local ai_output
    ai_output=$(call_ai_model_configured "$model" "$prompt")
    local ai_exit_code=$?
    
    # Check for usage limits
    if is_usage_limit_error "$ai_output" "$model"; then
      echo "[AI] $model hit usage limit - trying next model" >&2
      limited_models+=("$model")
      continue
    fi
    
    # Validate output
    if is_valid_ai_output "$ai_output" "$ai_exit_code"; then
      # Clean output if needed
      ai_output=$(clean_ai_output "$ai_output" "$model")
      echo "[AI] $model succeeded" >&2
      # Output the cleaned result
      echo "$ai_output"
      return 0
    fi
    
    echo "[AI] $model failed (exit code $ai_exit_code), trying next model..." >&2
  done
  
  # All models have been tried
  echo "[AI] All models in rotation have been tried" >&2
  
  # Check if all models hit limits
  if [[ ${#limited_models[@]} -gt 0 ]] && [[ ${#limited_models[@]} -eq ${#tried_models[@]} ]]; then
    echo "[AI] All models hit usage limits: ${limited_models[*]}" >&2
    return 3  # Special exit code for all models hitting limits
  fi
  
  return 1
}

# Legacy function name for compatibility
call_ai_with_fallbacks() {
  call_ai_with_round_robin "$@"
}