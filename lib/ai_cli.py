#!/usr/bin/env python3
"""
Python wrapper around ai-cli.sh for AI model invocation.
AIDEV-NOTE: ai-cli.sh handles model commands, Python handles timeouts.
Timeouts were moved from bash to Python because the bash `timeout` command
causes claude CLI and gemini CLI to hang in nested subprocess contexts.
"""

import os
import random
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, List


def _log(msg: str):
    """Log with timestamp. AI CLI uses its own logging to avoid import cycles."""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [AI] {msg}", file=sys.stderr, flush=True)

# Path to ai-cli.sh relative to this file
SCRIPT_DIR = Path(__file__).parent
AI_CLI_PATH = SCRIPT_DIR / "ai-cli.sh"


class AIError(Exception):
    """Base exception for AI errors."""
    pass


class RateLimitError(AIError):
    """Rate limit hit - should retry later."""
    pass


class APIExhaustedError(AIError):
    """API quota exhausted - stop processing."""
    pass


class TimeoutError(AIError):
    """AI call timed out."""
    pass


def get_git_protection_warning() -> str:
    """Get the git protection warning that must prefix all AI prompts."""
    return '''!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
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
'''


def call_ai(
    prompt: str,
    command: str = "run",
    working_dir: Optional[str] = None,
    env_vars: Optional[dict] = None
) -> Tuple[str, str]:
    """
    Call AI using the configured models via ai-cli.sh.

    Args:
        prompt: The prompt to send to the AI
        command: Either "run" or "ideate" - determines which model pool to use
        working_dir: Directory to run the command in (for file editing)
        env_vars: Additional environment variables to pass

    Returns:
        Tuple of (output, model_name)

    Raises:
        TimeoutError: If the AI call times out
        RateLimitError: If rate limited
        APIExhaustedError: If API quota exhausted
        AIError: For other AI errors
    """
    # Create temp file for model name (ai-cli.sh writes to /tmp/.claude-evolve-model-$$)
    pid = os.getpid()
    model_file = f"/tmp/.claude-evolve-model-{pid}"

    # Build the bash command that sources config and calls the AI
    # We need to source config.sh and call load_config to get LLM_RUN/LLM_IDEATE variables
    bash_script = f'''
        source "{SCRIPT_DIR}/config.sh"
        load_config
        source "{AI_CLI_PATH}"
        call_ai_random "$1" "$2"
    '''

    # Setup environment
    env = os.environ.copy()
    if working_dir:
        env['CLAUDE_EVOLVE_WORKING_DIR'] = working_dir
    if env_vars:
        env.update(env_vars)

    try:
        result = subprocess.run(
            ["bash", "-c", bash_script, "bash", prompt, command],
            capture_output=True,
            text=True,
            cwd=working_dir,
            env=env
        )

        output = result.stdout
        stderr = result.stderr
        exit_code = result.returncode

        # Print stderr (contains model selection and debug info)
        if stderr:
            for line in stderr.strip().split('\n'):
                if line:
                    print(f"  {line}", file=sys.stderr)

        # Read model name from temp file
        model_name = "unknown"
        if os.path.exists(model_file):
            with open(model_file) as f:
                model_name = f.read().strip()
            os.remove(model_file)

        # Handle exit codes
        if exit_code == 124:
            raise TimeoutError(f"AI call timed out (model: {model_name})")
        elif exit_code == 2:
            raise RateLimitError(f"Rate limit hit (model: {model_name})")
        elif exit_code == 3:
            raise APIExhaustedError(f"API quota exhausted (model: {model_name})")
        elif exit_code != 0:
            raise AIError(f"AI call failed with exit code {exit_code}: {stderr}")

        return output, model_name

    except subprocess.SubprocessError as e:
        raise AIError(f"Failed to call AI: {e}")


def get_models_for_command(command: str) -> List[str]:
    """
    Get the list of primary models for a command.

    Args:
        command: Either "run" or "ideate"

    Returns:
        List of model names
    """
    bash_script = f'''
        source "{SCRIPT_DIR}/config.sh"
        load_config
        case "$1" in
            run) echo "$LLM_RUN" ;;
            ideate) echo "$LLM_IDEATE" ;;
        esac
    '''

    result = subprocess.run(
        ["bash", "-c", bash_script, "bash", command],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        return []

    model_list = result.stdout.strip()
    if not model_list:
        return []

    return model_list.split()


def get_fallback_models_for_command(command: str) -> List[str]:
    """
    Get the list of fallback models for a command.

    Args:
        command: Either "run" or "ideate"

    Returns:
        List of fallback model names
    """
    bash_script = f'''
        source "{SCRIPT_DIR}/config.sh"
        load_config
        case "$1" in
            run) echo "$LLM_RUN_FALLBACK" ;;
            ideate) echo "$LLM_IDEATE_FALLBACK" ;;
        esac
    '''

    result = subprocess.run(
        ["bash", "-c", bash_script, "bash", command],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        return []

    model_list = result.stdout.strip()
    if not model_list:
        return []

    return model_list.split()


# AIDEV-NOTE: Model timeout lookup. Timeouts are handled here in Python, not
# in bash, because the bash `timeout` command causes claude CLI (and sometimes
# gemini CLI) to hang when called from nested subprocess contexts.
MODEL_TIMEOUTS = {
    # Claude models - 5 minutes for standard, 30 minutes for thinking
    'opus': 300, 'sonnet': 300, 'haiku': 300,
    'opus-think': 1800, 'sonnet-think': 1800,
    # Gemini - 30 min for pro (streams while working), 20 min for flash
    'gemini-pro': 1800, 'gemini-flash': 1200, 'gemini-3-flash': 600,
    'gemini-3-pro-preview': 1800, 'gemini-5-flash': 600,
    # Codex/OpenAI models - 10 min standard
    'gpt-5-codex': 600, 'gpt-5.2': 600, 'gpt-5.3-codex': 600,
    'gpt-5.3-codex-spark': 300,
    # Z.AI agentic modes - 30 min (can be slow)
    'glm-zai': 1800, 'glm-5-zai': 1800,
    # Codex local - 40 min (local inference can be slow)
    'codex-oss-local': 2400,
}
DEFAULT_MODEL_TIMEOUT = 600  # 10 minutes for everything else


def get_model_timeout(model_name: str) -> int:
    """Get the timeout in seconds for a given model."""
    return MODEL_TIMEOUTS.get(model_name, DEFAULT_MODEL_TIMEOUT)


def call_ai_model(
    prompt: str,
    model_name: str,
    working_dir: Optional[str] = None,
    env_vars: Optional[dict] = None
) -> Tuple[str, str]:
    """
    Call a specific AI model.

    AIDEV-NOTE: Timeouts are handled here in Python using subprocess.Popen +
    process group kill. The bash timeout command was removed because it causes
    claude CLI and gemini CLI to hang in nested subprocess contexts.

    Args:
        prompt: The prompt to send to the AI
        model_name: The specific model to use
        working_dir: Directory to run the command in
        env_vars: Additional environment variables

    Returns:
        Tuple of (output, model_name)

    Raises:
        TimeoutError, RateLimitError, APIExhaustedError, AIError
    """
    bash_script = f'''
        source "{SCRIPT_DIR}/config.sh"
        load_config
        source "{AI_CLI_PATH}"
        call_ai_model_configured "$1" "$2"
    '''

    env = os.environ.copy()
    if working_dir:
        env['CLAUDE_EVOLVE_WORKING_DIR'] = working_dir
    if env_vars:
        env.update(env_vars)

    timeout_secs = get_model_timeout(model_name)

    try:
        # Use Popen with process group so we can kill all children on timeout
        proc = subprocess.Popen(
            ["bash", "-c", bash_script, "bash", model_name, prompt],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=working_dir,
            env=env,
            start_new_session=True,  # Creates new process group
        )

        try:
            output, stderr = proc.communicate(timeout=timeout_secs)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            # Kill the entire process group
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                time.sleep(2)
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            proc.kill()
            proc.wait()
            raise TimeoutError(f"AI call timed out (model: {model_name})")

        # Print stderr (contains debug info)
        if stderr:
            for line in stderr.strip().split('\n'):
                if line:
                    print(f"  {line}", file=sys.stderr)

        # Handle exit codes
        if exit_code == 124:
            raise TimeoutError(f"AI call timed out (model: {model_name})")
        elif exit_code == 2:
            raise RateLimitError(f"Rate limit hit (model: {model_name})")
        elif exit_code == 3:
            raise APIExhaustedError(f"API quota exhausted (model: {model_name})")
        elif exit_code != 0:
            raise AIError(f"AI call failed with exit code {exit_code}: {stderr}")

        return output, model_name

    except (subprocess.SubprocessError, OSError) as e:
        if isinstance(e, subprocess.TimeoutExpired):
            raise TimeoutError(f"AI call timed out (model: {model_name})")
        raise AIError(f"Failed to call AI: {e}")


def _try_models_with_backoff(
    prompt: str,
    models: List[str],
    tier_name: str,
    working_dir: Optional[str],
    env_vars: Optional[dict],
    max_rounds: int,
    initial_wait: int,
    max_wait: int
) -> Tuple[Optional[str], Optional[str], dict]:
    """
    Try a list of models with round-based retries and exponential backoff.

    Returns:
        Tuple of (output, model_name, last_errors)
        output/model_name are None if all models failed
    """
    wait_time = initial_wait
    last_errors = {}

    for round_num in range(max_rounds):
        shuffled_models = models.copy()
        random.shuffle(shuffled_models)

        _log(f"{tier_name} round {round_num + 1}/{max_rounds}: trying {len(shuffled_models)} models")

        for model in shuffled_models:
            try:
                _log(f"Trying {model}...")
                output, model_name = call_ai_model(prompt, model, working_dir, env_vars)
                if round_num > 0:
                    _log(f"Succeeded on round {round_num + 1} with {model}")
                else:
                    _log(f"Success with {model}")
                return output, model_name, last_errors
            except AIError as e:
                _log(f"{model} failed: {str(e)[:60]}...")
                last_errors[model] = str(e)

        # All models failed in this round
        if round_num < max_rounds - 1:
            _log(f"All {tier_name} models failed in round {round_num + 1}, waiting {wait_time}s...")
            time.sleep(wait_time)
            wait_time = min(wait_time * 2, max_wait)

    return None, None, last_errors


def call_ai_with_backoff(
    prompt: str,
    command: str = "ideate",
    working_dir: Optional[str] = None,
    env_vars: Optional[dict] = None,
    max_rounds: int = 10,
    initial_wait: int = 60,
    max_wait: int = 600,
    use_fallback: bool = True
) -> Tuple[str, str]:
    """
    Call AI with tiered fallback and round-based retries with exponential backoff.

    AIDEV-NOTE: Tiered fallback system:
    1. First tries all primary models with backoff
    2. If primary exhausted and use_fallback=True, tries fallback models
    3. Fallback models are cheaper/simpler backups (haiku, flash, etc.)

    Args:
        prompt: The prompt to send
        command: "run" or "ideate" - determines model pool
        working_dir: Directory for file operations
        env_vars: Additional environment variables
        max_rounds: Maximum number of full rounds per tier
        initial_wait: Initial wait time in seconds after first failed round
        max_wait: Maximum wait time in seconds between rounds
        use_fallback: Whether to try fallback tier if primary fails

    Returns:
        Tuple of (output, model_name)

    Raises:
        AIError: If all tiers exhausted without success
    """
    # Try primary tier first
    primary_models = get_models_for_command(command)
    if not primary_models:
        raise AIError(f"No primary models configured for command: {command}")

    output, model_name, primary_errors = _try_models_with_backoff(
        prompt, primary_models, "Primary",
        working_dir, env_vars, max_rounds, initial_wait, max_wait
    )

    if output is not None:
        return output, model_name

    # Primary exhausted - try fallback if enabled
    if use_fallback:
        fallback_models = get_fallback_models_for_command(command)
        if fallback_models:
            _log(f"Primary tier exhausted, trying {len(fallback_models)} fallback models...")

            output, model_name, fallback_errors = _try_models_with_backoff(
                prompt, fallback_models, "Fallback",
                working_dir, env_vars, max_rounds, initial_wait, max_wait
            )

            if output is not None:
                return output, model_name

            # Both tiers exhausted
            all_errors = {**primary_errors, **fallback_errors}
            error_summary = "; ".join(f"{m}: {e[:50]}" for m, e in list(all_errors.items())[:3])
            raise AIError(f"All tiers exhausted ({max_rounds} rounds each). Last errors: {error_summary}")

    # Primary exhausted, no fallback
    error_summary = "; ".join(f"{m}: {e[:50]}" for m, e in list(primary_errors.items())[:3])
    raise AIError(f"Primary tier exhausted ({max_rounds} rounds). Last errors: {error_summary}")


def call_ai_for_file_edit(
    prompt: str,
    file_path: str,
    command: str = "run",
    working_dir: Optional[str] = None
) -> Tuple[bool, str]:
    """
    Call AI to edit a specific file.

    This is used when the AI needs to modify files directly (like CSV editing
    during ideation). The file path is passed in the prompt context.

    Args:
        prompt: The prompt including file editing instructions
        file_path: Path to the file being edited (for verification)
        command: Either "run" or "ideate"
        working_dir: Directory to run in

    Returns:
        Tuple of (success: bool, model_name: str)
    """
    # Get file mtime before
    before_mtime = None
    if os.path.exists(file_path):
        before_mtime = os.path.getmtime(file_path)

    try:
        output, model_name = call_ai(prompt, command, working_dir)

        # Verify file was modified
        if os.path.exists(file_path):
            after_mtime = os.path.getmtime(file_path)
            if before_mtime is not None and after_mtime > before_mtime:
                return True, model_name

        # File not modified - might be an error
        return False, model_name

    except AIError:
        raise


if __name__ == "__main__":
    # Quick test
    print("Testing AI CLI wrapper...")
    print(f"AI CLI path: {AI_CLI_PATH}")
    print(f"AI CLI exists: {AI_CLI_PATH.exists()}")
    print("\nGit protection warning:")
    print(get_git_protection_warning()[:200] + "...")
