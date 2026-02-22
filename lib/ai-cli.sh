#!/bin/bash
# Centralized AI CLI invocation library for claude-evolve
#
# AIDEV-NOTE: Timeouts are now handled by the Python caller (ai_cli.py), not by
# bash timeout commands. This allows for better control and monitoring of AI CLI
# processes from the Python layer, including graceful timeout handling and
# proper error recovery. The bash functions here focus on clean command execution
# without timeout wrapping.

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
  local codex_gpt5_model="${CODEX_GPT5_MODEL:-gpt-5.2}"
  
  # Record start time
  local start_time=$(date +%s)
  
  # Build command directly based on model
  case "$model_name" in
    opus)
      local ai_output
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet)
      local ai_output
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet-think)
      local ai_output
      # Use extended thinking with sonnet 4.5 - prepend ultrathink instruction
      # AIDEV-NOTE: Extended thinking can take long for complex ideation
      local think_prompt="ultrathink

$prompt"
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-think)
      local ai_output
      # Use extended thinking with opus - prepend ultrathink instruction
      # AIDEV-NOTE: Extended thinking can take long for complex ideation
      local think_prompt="ultrathink

$prompt"
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    haiku)
      local ai_output
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model haiku -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5high)
      local ai_output
      ai_output=$(codex exec -m "$codex_gpt5_model" -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt5)
      local ai_output
      ai_output=$(codex exec -m "$codex_gpt5_model" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt-5-codex)
      local ai_output
      # GPT-5 Codex - code-specialized variant via Codex CLI
      ai_output=$(codex exec -m gpt-5-codex --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt-5.2)
      local ai_output
      # GPT-5.2 via Codex CLI
      ai_output=$(codex exec -m gpt-5.2 --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt-5.3-codex)
      local ai_output
      # GPT-5.3 Codex via Codex CLI
      ai_output=$(codex exec -m gpt-5.3-codex --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt-5.3-codex-spark)
      local ai_output
      # GPT-5.3 Codex Spark - lightweight fallback via Codex CLI
      ai_output=$(codex exec -m gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    o3high)
      local ai_output
      ai_output=$(codex exec -m o3-mini -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-pro)
      local ai_output
      # Gemini streams output while working
      ai_output=$(gemini -y -m gemini-3-pro-preview -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-flash)
      local ai_output
      # Gemini streams output while working
      ai_output=$(gemini -y -m gemini-2.5-flash -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-5-flash)
      local ai_output
      # Gemini 5 Flash - cheap fallback model
      ai_output=$(gemini -y -m gemini-5-flash -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-3-pro-preview)
      local ai_output
      # Gemini v3 Pro Preview via OpenRouter - EXPENSIVE
      ai_output=$(opencode -m openrouter/google/gemini-3-pro-preview run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-3-flash)
      local ai_output
      # Gemini 3 Flash - fast, cheap, strong thinker
      ai_output=$(opencode -m openrouter/google/gemini-3-flash-preview run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-sonnet)
      local ai_output
      ai_output=$(cursor-agent sonnet-4.5 -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-opus)
      local ai_output
      ai_output=$(cursor-agent opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-openrouter)
      local ai_output
      ai_output=$(opencode -m openrouter/z-ai/glm-4.7 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-5)
      local ai_output
      # GLM-5: 744B MoE model, very cheap ($0.80/$2.56 per 1M tokens), 200K context
      # Released Feb 2026 - scores 77.8% SWE-bench, MIT license
      ai_output=$(opencode -m openrouter/z-ai/glm-5 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-zai)
      # GLM 4.7 via Z.AI agentic mode -- can be slow sometimes
      local ai_output
      ai_output=$(opencode -m zai-coding-plan/glm-4.7 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-5-zai)
      # GLM-5 via Z.AI agentic mode - supports file editing for ideation
      # 744B MoE, strong reasoning, can edit files
      local ai_output
      ai_output=$(opencode -m zai-coding-plan/glm-5 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-openrouter)
      local ai_output
      ai_output=$(opencode -m openrouter/deepseek/deepseek-v3.2 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-code-fast-openrouter)
      local ai_output
      ai_output=$(opencode -m openrouter/x-ai/grok-code-fast-1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-4-openrouter)
      local ai_output
      # EXPENSIVE - consider grok-4.1-fast instead
      ai_output=$(opencode -m openrouter/x-ai/grok-4 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-4.1-fast)
      local ai_output
      # Grok 4.1 Fast - close to Grok 4 quality, much cheaper
      ai_output=$(opencode -m openrouter/x-ai/grok-4.1-fast run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-openrouter)
      local ai_output
      ai_output=$(opencode -m openrouter/anthropic/claude-opus-4.1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2-openrouter)
      local ai_output
      # Kimi K2 Thinking via OpenRouter (no separate auth needed)
      ai_output=$(opencode -m openrouter/moonshotai/kimi-k2-thinking run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2-think-moonshot)
      local ai_output
      # Use kimi CLI directly (assumes kimi is installed and configured)
      ai_output=$(kimi --print -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-coder)
      local ai_output
      # Kimi for Coding model via kimi CLI (fast coding-focused model)
      # Use --print to see agent actions while still allowing file modifications
      ai_output=$(kimi --print -y -m kimi-for-coding -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-k2.5)
      local ai_output
      # Kimi K2.5 - Moonshot's most powerful model (Jan 2025)
      # Native multimodal agentic model, stronger than GLM-4.7
      ai_output=$(opencode -m openrouter/moonshotai/kimi-k2.5 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    qwen)
      local ai_output
      # Qwen latest - Alibaba's flagship model (currently qwen3.5-plus)
      # Linear attention + sparse MoE, strong multimodal capabilities
      ai_output=$(opencode -m openrouter/qwen/qwen3.5-plus-02-15 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-oss-local)
      # Codex-OSS via Codex CLI with Ollama backend
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-v3-llamacloud)
      # Deepseek via Codex CLI with Ollama cloud backend
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss -m deepseek-v3.1:671b-cloud "$prompt" 2>&1)
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

# Get primary models for a specific command (run or ideate)
# Usage: get_models_for_command <command>
# Returns: Space-separated list of model names
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

  echo "$model_list"
}

# Get fallback models for a specific command (run or ideate)
# Usage: get_fallback_models_for_command <command>
# Returns: Space-separated list of fallback model names
get_fallback_models_for_command() {
  local command="$1"
  local model_list=""

  case "$command" in
    run)
      model_list="$LLM_RUN_FALLBACK"
      ;;
    ideate)
      model_list="$LLM_IDEATE_FALLBACK"
      ;;
    *)
      echo "[ERROR] Unknown command: $command" >&2
      return 1
      ;;
  esac

  echo "$model_list"
}

# Call AI with random model selection (no fallback)
# Usage: call_ai_random <prompt> <command>
# command: "run" or "ideate"
# Picks one random model from the list and uses it
# AIDEV-NOTE: This function writes the selected model to a temp file because
# export doesn't work from subshells (command substitution creates a subshell).
# The parent process should read /tmp/.claude-evolve-model-$$ to get the model name.
call_ai_random() {
  local prompt="$1"
  local command="$2"

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

  # Pick one random model
  local num_models=${#models[@]}
  local random_index=$((RANDOM % num_models))
  local model="${models[$random_index]}"

  echo "[AI] Selected $model for $command (random from $num_models models)" >&2

  # Write model to temp file so parent can read it
  # (exports don't propagate from subshells created by $(...) command substitution)
  local model_file="/tmp/.claude-evolve-model-$$"
  echo "$model" > "$model_file"

  # Call the AI model
  local ai_output
  ai_output=$(call_ai_model_configured "$model" "$prompt")
  local ai_exit_code=$?

  # Clean output if needed
  ai_output=$(clean_ai_output "$ai_output" "$model")

  # Log result
  if [[ $ai_exit_code -eq 0 ]]; then
    echo "[AI] $model returned exit code 0" >&2
  elif [[ $ai_exit_code -eq 124 ]]; then
    echo "[AI] $model timed out (exit code: 124)" >&2
  else
    echo "[AI] $model returned exit code $ai_exit_code" >&2
  fi

  # Output the result
  echo "$ai_output"
  return $ai_exit_code
}

# Legacy function names for compatibility
call_ai_with_round_robin() {
  call_ai_random "$@"
}

call_ai_with_fallbacks() {
  call_ai_random "$@"
}
