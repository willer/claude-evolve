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
  local codex_gpt_model="${CODEX_GPT_MODEL:-${CODEX_GPT5_MODEL:-gpt-5.2}}"
  
  # Record start time
  local start_time=$(date +%s)
  
  # Build command directly based on model
  # AIDEV-NOTE: Model names are role-based, never versioned. When upgrading a model,
  # update the model ID in the command below, not the case label.
  case "$model_name" in
    # --- Claude (subscription) ---
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
    haiku)
      local ai_output
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model haiku -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-think)
      local ai_output
      local think_prompt="ultrathink

$prompt"
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    sonnet-think)
      local ai_output
      local think_prompt="ultrathink

$prompt"
      ai_output=$(claude --dangerously-skip-permissions --mcp-config '' --model sonnet -p "$think_prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    opus-openrouter)
      local ai_output
      ai_output=$(opencode -m openrouter/anthropic/claude-opus-4.7 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-sonnet)
      local ai_output
      ai_output=$(cursor-agent sonnet-4.6 -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    cursor-opus)
      local ai_output
      ai_output=$(cursor-agent opus -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Codex/GPT (subscription) ---
    gpt)
      local ai_output
      ai_output=$(codex exec -m "$codex_gpt_model" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gpt-high)
      local ai_output
      ai_output=$(codex exec -m "$codex_gpt_model" -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-think)
      local ai_output
      # High reasoning - for ideation tasks requiring deep thinking
      ai_output=$(codex exec -m gpt-5.4 -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-coding)
      local ai_output
      # Medium reasoning - for coding/implementation tasks
      ai_output=$(codex exec -m gpt-5.4 -c model_reasoning_effort="medium" --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    codex-spark)
      local ai_output
      # Cheap/fast lightweight fallback
      ai_output=$(codex exec -m gpt-5.1-codex-mini --dangerously-bypass-approvals-and-sandbox "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Gemini (subscription) ---
    gemini-pro)
      local ai_output
      # Auto-routing to best Gemini model - streams output while working
      ai_output=$(gemini -y -m auto-gemini-3 -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-flash)
      local ai_output
      ai_output=$(gemini -y -m gemini-2.5-flash -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-cheap)
      local ai_output
      # Fast cheap fallback via gemini CLI
      ai_output=$(gemini -y -m gemini-3-flash-preview -p "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    gemini-pro-openrouter)
      local ai_output
      # Gemini Pro via OpenRouter - EXPENSIVE
      ai_output=$(opencode -m openrouter/google/gemini-3-pro-preview run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- GLM / Z.AI ---
    glm)
      local ai_output
      # Latest GLM flagship via OpenRouter
      ai_output=$(opencode -m openrouter/z-ai/glm-5.1 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    glm-zai)
      local ai_output
      # Latest GLM via Z.AI agentic mode (may lag OpenRouter by one version)
      ai_output=$(opencode -m zai-coding-plan/glm-5 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Qwen / Alibaba ---
    qwen)
      local ai_output
      # Latest Qwen flagship via OpenRouter
      ai_output=$(opencode -m openrouter/qwen/qwen3.6-plus run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    qwen-coder)
      local ai_output
      # Qwen coding specialist - large MoE
      ai_output=$(opencode -m openrouter/qwen/qwen3-coder run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- DeepSeek ---
    deepseek)
      local ai_output
      # Latest DeepSeek via OpenRouter
      ai_output=$(opencode -m openrouter/deepseek/deepseek-v3.2 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    deepseek-local)
      local ai_output
      # DeepSeek via Codex CLI with Ollama cloud backend
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama -m deepseek-v3.1:671b-cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Kimi / Moonshot ---
    kimi-coder)
      local ai_output
      # Kimi coding model via kimi CLI
      ai_output=$(kimi --print -y -m kimi-for-coding -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-think)
      local ai_output
      # Kimi thinking via kimi CLI
      ai_output=$(kimi --print -c "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    kimi-openrouter)
      local ai_output
      # Latest Kimi via OpenRouter
      ai_output=$(opencode -m openrouter/moonshotai/kimi-k2.5 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Grok / xAI ---
    grok)
      local ai_output
      # Latest Grok via OpenRouter - EXPENSIVE
      ai_output=$(opencode -m openrouter/x-ai/grok-4 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    grok-fast)
      local ai_output
      # Grok fast variant - close to full quality, much cheaper
      ai_output=$(opencode -m openrouter/x-ai/grok-4.1-fast run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- MiniMax ---
    minimax)
      local ai_output
      # Latest MiniMax reasoning model via OpenRouter
      ai_output=$(opencode -m openrouter/minimax/minimax-m2.7 run "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Ollama cloud models (flat-rate subscription) ---
    ollama-glm)
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama -m glm-5.1:cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    ollama-gemma)
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama -m gemma4:31b-cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    ollama-minimax)
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama -m minimax-m2.7:cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    ollama-qwen)
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama -m qwen3.6:cloud "$prompt" 2>&1)
      local ai_exit_code=$?
      ;;
    # --- Local inference ---
    codex-local)
      local ai_output
      ai_output=$(codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --oss --local-provider=ollama "$prompt" 2>&1)
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
      echo "... (truncated from ${#ai_output} characters to last 50 lines) ..." >&2
      echo "$ai_output" | tail -50 >&2
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
  if [[ "$model_name" == "codex" || "$model_name" == "gpt" || "$model_name" == "gpt-high" ]]; then
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

# Get escalation models for a specific command (run or ideate)
# AIDEV-NOTE: Escalation models are big/commercial models used only when
# cheap primary models produce code with syntax or validation errors.
# Usage: get_escalation_models_for_command <command>
# Returns: Space-separated list of escalation model names
get_escalation_models_for_command() {
  local command="$1"
  local model_list=""

  case "$command" in
    run)
      model_list="$LLM_RUN_ESCALATION"
      ;;
    ideate)
      model_list="$LLM_IDEATE_ESCALATION"
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
