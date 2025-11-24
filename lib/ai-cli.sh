#!/bin/bash
# Centralized AI CLI invocation library for claude-evolve
#
# AIDEV-NOTE: All timeout commands use -k flag to ensure process termination
# The -k flag sends SIGKILL if the process doesn't respond to SIGTERM within
# the grace period (30 seconds). This prevents AI CLI processes from hanging
# indefinitely when they ignore the initial SIGTERM signal.
# Example: timeout -k 30 600 means:
#   - Wait 600 seconds, then send SIGTERM
#   - If still running after 30 more seconds, send SIGKILL (force kill)

# Source config to get LLM_CLI array and model lists
# This will be sourced after config.sh in the main scripts

# Generate ultra-prominent git warning for AI prompts
# This MUST be at the TOP of every AI prompt to prevent git operations
get_git_protection_warning() {
  cat <<'EOF'
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!
!!! ⛔ ABSOLUTE PROHIBITION - READ THIS FIRST ⛔
!!!
!!! YOU ARE STRICTLY FORBIDDEN FROM USING ANY GIT COMMANDS WHATSOEVER
!!!
!!! ❌ FORBIDDEN: git commit, git add, git reset, git checkout, git revert,
!!!              git branch, git merge, git stash, git clean, git push, git pull
!!!              OR ANY OTHER COMMAND STARTING WITH 'git'
!!!
!!! ⚠️  WHY: This runs in production. Git operations have caused DATA LOSS.
!!!          Multiple times AIs have corrupted evolution runs with git commands.
!!!          Version control is ONLY managed by the human operator.
!!!
!!! ✅ WHAT YOU CAN DO: Edit files directly using file editing tools ONLY.
!!!                     Never touch version control. Ever.
!!!
!!! 💀 IF YOU USE GIT: You will corrupt the entire evolution run and lose data.
!!!                    This is an automated system. No git operations allowed.
!!!
!!! 🚨 CONSEQUENCES: If you execute ANY git command, the human operator will be
!!!                  forced to SHUT DOWN ALL AI-BASED EVOLUTION WORK and switch
!!!                  to manual-only mode. You will cause the termination of this
!!!                  entire automated evolution system. DO NOT BE THAT AI.
!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

EOF
}

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
      ai_output=$(timeout -k 30 300 claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet)
      local ai_output
      ai_output=$(timeout -k 30 300 claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet-think)
      local ai_output
      # Use extended thinking with sonnet 4.5 - prepend ultrathink instruction
      local think_prompt="ultrathink

$prompt"
      ai_output=$(timeout -k 30 600 claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-think)
      local ai_output
      # Use extended thinking with opus - prepend ultrathink instruction
      local think_prompt="ultrathink

$prompt"
      ai_output=$(timeout -k 30 600 claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    haiku)
      local ai_output
      ai_output=$(timeout -k 30 300 claude --dangerously-skip-permissions --mcp-config '' --model haiku -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5high)
      local ai_output
      ai_output=$(timeout -k 30 600 codex exec -m gpt-5.1 -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5)
      local ai_output
      ai_output=$(timeout -k 30 600 codex exec -m gpt-5.1 --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    o3high)
      local ai_output
      ai_output=$(timeout -k 30 600 codex exec -m o3-mini -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-pro)
      local ai_output
      # Gemini needs longer timeout as it streams output while working (20 minutes)
      ai_output=$(timeout -k 30 1800 gemini -y -m gemini-3-pro-preview -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-flash)
      local ai_output
      # Gemini needs longer timeout as it streams output while working (20 minutes)
      ai_output=$(timeout -k 30 1200 gemini -y -m gemini-2.5-flash -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-3-pro-preview)
      local ai_output
      # Gemini v3 Pro Preview via OpenRouter (30 minute timeout)
      ai_output=$(timeout -k 30 1800 opencode -m openrouter/google/gemini-3-pro-preview run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-sonnet)
      local ai_output
      ai_output=$(timeout -k 30 600 cursor-agent sonnet-4.5 -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-opus)
      local ai_output
      ai_output=$(timeout -k 30 600 cursor-agent opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-openrouter)
      local ai_output
      ai_output=$(timeout -k 30 600 opencode -m openrouter/z-ai/glm-4.6 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-zai)
      # GLM -- can be slow sometimes
      local ai_output
      ai_output=$(timeout -k 30 1800 opencode -m zai-coding-plan/glm-4.6 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-openrouter)
      local ai_output
      ai_output=$(timeout -k 30 600 opencode -m openrouter/deepseek/deepseek-v3.1-terminus run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-code-fast-openrouter)
      local ai_output
      ai_output=$(timeout -k 30 600 opencode -m openrouter/x-ai/grok-code-fast-1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-4-openrouter)
      local ai_output
      ai_output=$(timeout -k 30 600 opencode -m openrouter/x-ai/grok-4 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-openrouter)
      local ai_output
      ai_output=$(timeout -k 30 600 opencode -m openrouter/anthropic/claude-opus-4.1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2-openrouter)
      local ai_output
      # Kimi K2 Thinking via OpenRouter (no separate auth needed)
      ai_output=$(timeout -k 30 600 opencode -m openrouter/moonshotai/kimi-k2-thinking run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2-think-moonshot)
      local ai_output
      # Use kimi CLI directly (assumes kimi is installed and configured)
      ai_output=$(timeout -k 30 600 kimi --print -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-coder)
      local ai_output
      # Kimi for Coding model via kimi CLI (fast coding-focused model)
      # Use --print to see agent actions while still allowing file modifications
      ai_output=$(timeout -k 30 600 kimi --print -y -m kimi-for-coding -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-oss-local)
      # Codex-OSS via Codex CLI with Ollama backend
      local ai_output
      ai_output=$(timeout -k 30 2400 codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-v3-llamacloud)
      # Deepseek via Codex CLI with Ollama cloud backend
      local ai_output
      ai_output=$(timeout -k 30 600 codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss -m deepseek-v3.1:671b-cloud "$prompt" 2>&1)
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

# Call AI with random selection and fallback support
# Usage: call_ai_with_round_robin <prompt> <command> <hash_value>
# command: "run" or "ideate"
# hash_value: unused (kept for backward compatibility)
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

  # Shuffle the models using Fisher-Yates algorithm for random selection
  local num_models=${#models[@]}
  for ((i=num_models-1; i>0; i--)); do
    local j=$((RANDOM % (i+1)))
    # Swap models[i] and models[j]
    local temp="${models[i]}"
    models[i]="${models[j]}"
    models[j]="$temp"
  done

  # Use the shuffled array directly
  local ordered_models=("${models[@]}")

  echo "[AI] Model order for $command (random): ${ordered_models[*]}" >&2
  
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
