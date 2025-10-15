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
  
  # Record start time
  local start_time=$(date +%s)
  
  # Build command directly based on model
  case "$model_name" in
    opus)
      local ai_output
      ai_output=$(timeout 300 claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet)
      local ai_output
      ai_output=$(timeout 300 claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet-think)
      local ai_output
      # Use extended thinking with sonnet 4.5 - prepend ultrathink instruction
      local think_prompt="ultrathink

$prompt"
      ai_output=$(timeout 600 claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-think)
      local ai_output
      # Use extended thinking with opus - prepend ultrathink instruction
      local think_prompt="ultrathink

$prompt"
      ai_output=$(timeout 600 claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5high)
      local ai_output
      ai_output=$(timeout 600 codex exec -m gpt-5 -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5)
      local ai_output
      ai_output=$(timeout 600 codex exec -m gpt-5 --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    o3high)
      local ai_output
      ai_output=$(timeout 600 codex exec -m o3-mini -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-pro)
      local ai_output
      # Gemini needs longer timeout as it streams output while working (20 minutes)
      ai_output=$(timeout 1200 gemini -y -m gemini-2.5-pro -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-flash)
      local ai_output
      # Gemini needs longer timeout as it streams output while working (20 minutes)
      ai_output=$(timeout 1200 gemini -y -m gemini-2.5-flash -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-sonnet)
      local ai_output
      ai_output=$(timeout 600 cursor-agent sonnet-4.5 -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-opus)
      local ai_output
      ai_output=$(timeout 600 cursor-agent opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-openrouter)
      local ai_output
      ai_output=$(timeout 600 opencode -m openrouter/z-ai/glm-4.6 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-zai)
      local ai_output
      ai_output=$(timeout 1200 opencode -m zai-coding-plan/glm-4.6 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-openrouter)
      local ai_output
      ai_output=$(timeout 600 opencode -m openrouter/deepseek/deepseek-v3.1-terminus run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-code-fast-openrouter)
      local ai_output
      ai_output=$(timeout 600 opencode -m openrouter/x-ai/grok-code-fast-1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-4-openrouter)
      local ai_output
      ai_output=$(timeout 600 opencode -m openrouter/x-ai/grok-4 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-oss-local)
      # Codex-OSS via Codex CLI with Ollama backend
      local ai_output
      ai_output=$(timeout 2400 codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2-llamacloud)
      # Kimi K2 via Codex CLI with Ollama cloud backend
      local ai_output
      ai_output=$(timeout 600 codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss -m kimi-k2:1t-cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-v3-llamacloud)
      # Deepseek via Codex CLI with Ollama cloud backend
      local ai_output
      ai_output=$(timeout 600 codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss -m deepseek-v3.1:671b-cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
  esac
  
  # Debug: log model and prompt size
  echo "[DEBUG] Calling $model_name with prompt of ${#prompt} characters" >&2
  
  # Calculate duration
  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  
  # Always log basic info with timing
  echo "[AI] $model_name exit code: $ai_exit_code, output length: ${#ai_output} chars, duration: ${duration}s" >&2
  
  # Show detailed output if verbose or if there was an error
  if [[ "${VERBOSE_AI_OUTPUT:-false}" == "true" ]] || [[ $ai_exit_code -ne 0 ]]; then
    echo "[AI] Raw output from $model_name:" >&2
    echo "----------------------------------------" >&2
    if [[ ${#ai_output} -gt 2000 ]]; then
      echo "$ai_output" | head -50 >&2
      echo "... (truncated from ${#ai_output} characters to first 50 lines) ..." >&2
    else
      echo "$ai_output" >&2
    fi
    echo "----------------------------------------" >&2
  fi
  
  # Debug: save full output if debugging is enabled
  if [[ "${DEBUG_AI_CALLS:-}" == "true" ]]; then
    local debug_file="/tmp/claude-evolve-ai-${model_name}-$$.log"
    echo "Model: $model_name" > "$debug_file"
    echo "Exit code: $ai_exit_code" >> "$debug_file"
    echo "Prompt length: ${#prompt}" >> "$debug_file"
    echo "Output:" >> "$debug_file"
    echo "$ai_output" >> "$debug_file"
    echo "[DEBUG] Full output saved to: $debug_file" >&2
  fi
  
  # Output the result
  echo "$ai_output"
  return $ai_exit_code
}

# DEPRECATED - Keep for compatibility but always return false
is_usage_limit_error() {
  return 1
}

# DEPRECATED - Just check exit code now
is_valid_ai_output() {
  local output="$1"
  local exit_code="$2"
  
  # Only check exit code - let the caller verify file changes
  return $exit_code
}

# Clean AI output if needed (e.g., extract from JSON)
clean_ai_output() {
  local output="$1"
  local model_name="$2"
  
  # Handle codex-specific output format
  if [[ "$model_name" == "codex" || "$model_name" == "o3high" || "$model_name" == "gpt5high" ]]; then
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
  
  # Calculate starting index for round‑robin
  # Use a random starting point to avoid always using the same model
  # for a given hash/value. This keeps the selection simple and
  # avoids retrying the same model in the event of failures.
  local num_models=${#models[@]}
  local start_index=$((RANDOM % num_models))
  
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
    
    # Clean output if needed
    ai_output=$(clean_ai_output "$ai_output" "$model")
    
    # Success if exit code is 0, or if it's just a timeout (124)
    # Timeout doesn't mean the AI failed - it may have completed the task
    if [[ $ai_exit_code -eq 0 ]] || [[ $ai_exit_code -eq 124 ]]; then
      if [[ $ai_exit_code -eq 124 ]]; then
        echo "[AI] $model timed out but continuing (exit code: 124)" >&2
      else
        echo "[AI] $model returned exit code 0" >&2
      fi
      # Export the successful model for tracking (used by worker)
      export SUCCESSFUL_RUN_MODEL="$model"
      # Debug: log what AI returned on success
      if [[ "${DEBUG_AI_SUCCESS:-}" == "true" ]]; then
        echo "[AI] $model success output preview:" >&2
        echo "$ai_output" | head -10 >&2
        echo "[AI] (truncated to first 10 lines)" >&2
      fi
      # Output the cleaned result
      echo "$ai_output"
      return 0
    fi
    
    echo "[AI] $model returned exit code $ai_exit_code, trying next model..." >&2
  done
  
  # All models have been tried
  echo "[AI] All models have been tried without success" >&2
  return 1
}

# Legacy function name for compatibility
call_ai_with_fallbacks() {
  call_ai_with_round_robin "$@"
}
