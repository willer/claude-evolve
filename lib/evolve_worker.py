#!/usr/bin/env python3
"""
Worker process for claude-evolve.
Processes a single pending candidate: generates code via AI and runs evaluator.

AIDEV-NOTE: This is the Python port of bin/claude-evolve-worker.
Exit codes:
  0 - Success
  1 - General failure
  2 - Rate limit (should retry later)
  3 - API exhausted (stop all processing)
  77 - AI generation failed after retries
  78 - Missing parent algorithm
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

# Add lib to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from lib.log import log, log_error, log_warn, log_debug, set_prefix
set_prefix("WORKER")

from lib.evolution_csv import EvolutionCSV
from lib.ai_cli import call_ai_with_backoff, get_git_protection_warning, AIError


@dataclass
class Config:
    """Worker configuration."""
    csv_path: str
    evolution_dir: str
    output_dir: str
    algorithm_path: str
    evaluator_path: str
    brief_path: str
    python_cmd: str = "python3"
    memory_limit_mb: int = 0
    timeout_seconds: int = 600
    max_candidates: int = 5
    max_validation_retries: int = 3  # Max attempts to fix validation errors (if validator.py exists)
    # Retry configuration with exponential backoff
    max_rounds: int = 10
    initial_wait: int = 60
    max_wait: int = 600


@dataclass
class Candidate:
    """Candidate to process."""
    id: str
    based_on_id: str
    description: str


class Worker:
    """Processes evolution candidates."""

    def __init__(self, config: Config):
        self.config = config
        self.csv = EvolutionCSV(config.csv_path)
        self.current_candidate_id: Optional[str] = None
        self._setup_signal_handlers()

    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown."""
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        """Handle termination signal - reset current candidate to pending."""
        sig_name = signal.Signals(signum).name
        log(f"Received {sig_name}")

        if self.current_candidate_id:
            log(f"Resetting {self.current_candidate_id} to pending")
            try:
                with EvolutionCSV(self.config.csv_path) as csv:
                    info = csv.get_candidate_info(self.current_candidate_id)
                    status = info.get('status', '').lower() if info else ''
                    # Don't reset if already complete or permanently failed
                    if status not in ('complete', 'failed', 'failed-ai-retry', 'failed-parent-missing'):
                        csv.update_candidate_status(self.current_candidate_id, 'pending')
            except Exception as e:
                log(f"Error resetting status: {e}")

        sys.exit(128 + signum)

    def _resolve_parent_id(self, parent_id: str) -> Tuple[Optional[str], Optional[Path]]:
        """
        Resolve parent ID to actual file.

        Args:
            parent_id: Parent ID (may be comma-separated for multi-parent)

        Returns:
            Tuple of (resolved_parent_id, parent_file_path) or (None, None) if not found
        """
        if not parent_id or parent_id == "baseline-000":
            return None, Path(self.config.algorithm_path)

        # Split by comma or space and try each
        candidates = re.split(r'[,;\s]+', parent_id)
        for candidate in candidates:
            candidate = candidate.strip()
            if not candidate:
                continue

            parent_file = Path(self.config.output_dir) / f"evolution_{candidate}.py"
            if parent_file.exists():
                return candidate, parent_file

        return None, None  # No valid parent found

    def _is_baseline(self, candidate_id: str, parent_id: str) -> bool:
        """Check if this is a baseline candidate."""
        if parent_id:
            return False
        return candidate_id in ('baseline', 'baseline-000', '000', '0', 'gen00-000')

    def _build_prompt(self, candidate: Candidate, target_basename: str) -> str:
        """Build the AI prompt for code evolution."""
        return f"""{get_git_protection_warning()}

Modify the algorithm in {target_basename} based on this description: {candidate.description}

The modification should be substantial and follow the description exactly. Make sure the algorithm still follows all interface requirements and can run properly.

Important: Make meaningful changes that match the description. Don't just add comments or make trivial adjustments.

IMPORTANT: If you need to read Python (.py) or CSV files, read them in chunks using offset and limit parameters to avoid context overload
Example: Read(file_path='evolution_gen01-001.py', offset=0, limit=100) then Read(offset=100, limit=100), etc.
This is especially important for models with smaller context windows (like GLM).

CRITICAL: If you do not know how to implement what was asked for, or if the requested change is unclear or not feasible, you MUST refuse to make any changes. DO NOT modify the code if you are uncertain about the implementation. Simply respond that you cannot implement the requested change and explain why. It is better to refuse than to make incorrect or random changes."""

    def _call_ai_with_backoff(self, prompt: str, target_file: Path) -> Tuple[bool, str]:
        """
        Call AI with round-based retry and exponential backoff.

        AIDEV-NOTE: Uses call_ai_with_backoff which tries all models in the pool,
        then waits with exponential backoff if all fail, and repeats.

        Returns:
            Tuple of (success, model_name)
        """
        # Get file hash before AI call
        hash_before = self._file_hash(target_file) if target_file.exists() else None

        try:
            output, model = call_ai_with_backoff(
                prompt,
                command="run",
                working_dir=self.config.evolution_dir,
                max_rounds=self.config.max_rounds,
                initial_wait=self.config.initial_wait,
                max_wait=self.config.max_wait
            )

            # Check if file was modified
            hash_after = self._file_hash(target_file) if target_file.exists() else None

            if hash_before != hash_after and hash_after is not None:
                log(f"AI successfully modified file (model: {model})")
                return True, model
            else:
                log(f"AI completed but did not modify file")
                return False, model

        except AIError as e:
            log_error(f"All AI retries exhausted: {e}")
            return False, ""

    def _file_hash(self, path: Path) -> Optional[str]:
        """Get file hash."""
        try:
            import hashlib
            return hashlib.sha256(path.read_bytes()).hexdigest()
        except Exception:
            return None

    def _check_syntax(self, file_path: Path) -> bool:
        """Check Python syntax."""
        try:
            result = subprocess.run(
                [self.config.python_cmd, "-m", "py_compile", str(file_path)],
                capture_output=True,
                text=True
            )
            return result.returncode == 0
        except Exception:
            return False

    def _find_validator(self) -> Optional[Path]:
        """
        Auto-detect validator.py in the evolution directory.
        No config required - if validator.py exists, we use it.
        """
        validator_path = Path(self.config.evolution_dir) / "validator.py"
        if validator_path.exists():
            return validator_path
        return None

    def _run_validator(self, candidate_id: str) -> Tuple[bool, Dict[str, Any]]:
        """
        Run the validator (fast smoke test) before full evaluation.

        AIDEV-NOTE: Auto-detects validator.py in evolution directory.
        Returns exit code 0 on success, non-zero on failure.
        Resilient to any output format - handles JSON, plain text, or nothing.

        Returns:
            Tuple of (success, error_info_dict)
            - success: True if validation passed
            - error_info: Dict with whatever info we could extract from output
        """
        validator_path = self._find_validator()
        if not validator_path:
            return True, {}  # No validator found, skip

        cmd = [self.config.python_cmd, str(validator_path), candidate_id]
        log(f"Running validator: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,  # Validator should be fast (~3 seconds)
                cwd=self.config.evolution_dir
            )

            # Combine stdout and stderr for full context
            stdout = result.stdout.strip() if result.stdout else ""
            stderr = result.stderr.strip() if result.stderr else ""
            combined_output = f"{stdout}\n{stderr}".strip()

            # Try to extract structured info, but be resilient to any format
            error_info = {'raw_output': combined_output}

            # Try to parse JSON from stdout (validator may output JSON)
            if stdout.startswith('{'):
                try:
                    parsed = json.loads(stdout)
                    if isinstance(parsed, dict):
                        error_info.update(parsed)
                except json.JSONDecodeError:
                    pass  # Not valid JSON, that's fine

            # If no structured error, use the raw output
            if 'error' not in error_info and combined_output:
                error_info['error'] = combined_output

            if result.returncode == 0:
                log("Validation passed")
                return True, error_info
            else:
                error_type = error_info.get('error_type', 'validation_failed')
                log_warn(f"Validation failed: {error_type}")
                return False, error_info

        except subprocess.TimeoutExpired:
            log_error("Validator timed out")
            return False, {'error': 'Validator timed out after 30 seconds', 'error_type': 'timeout'}
        except Exception as e:
            log_error(f"Validator error: {e}")
            return False, {'error': str(e), 'error_type': 'exception'}

    def _build_fix_prompt(self, candidate: Candidate, target_basename: str, error_info: Dict[str, Any]) -> str:
        """
        Build AI prompt to fix validation errors.

        AIDEV-NOTE: Resilient to any error_info structure - uses whatever is available.
        """
        prompt = f"""{get_git_protection_warning()}

The code in {target_basename} failed validation. Please fix the errors and try again.

## Validator Output

"""
        # Include whatever structured fields we have
        if error_info.get('error_type'):
            prompt += f"**Error Type:** {error_info['error_type']}\n\n"

        if error_info.get('error'):
            prompt += f"**Error:**\n{error_info['error']}\n\n"

        if error_info.get('suggestion'):
            prompt += f"**Suggested Fix:**\n{error_info['suggestion']}\n\n"

        if error_info.get('traceback'):
            tb = error_info['traceback']
            # Truncate if too long
            if len(tb) > 1500:
                tb = "..." + tb[-1500:]
            prompt += f"**Traceback:**\n```\n{tb}\n```\n\n"

        # If we only have raw output (no structured fields), show that
        if not any(error_info.get(k) for k in ('error', 'error_type', 'suggestion', 'traceback')):
            raw = error_info.get('raw_output', 'No output captured')
            # Truncate if needed
            if len(raw) > 2000:
                raw = raw[:2000] + "\n... (truncated)"
            prompt += f"```\n{raw}\n```\n\n"

        prompt += f"""## Instructions

1. Read the file {target_basename} to understand the current code
2. Identify the issue based on the validator output above
3. Fix the code to resolve the validation error
4. The fix should still implement: {candidate.description}

**CRITICAL:** Make sure to actually fix the error. Do not just add comments or make cosmetic changes.

To help debug, you can run the validator yourself:
```
python validator.py {target_basename}
```
"""

        return prompt

    def _run_evaluator(self, candidate_id: str, is_baseline: bool) -> Tuple[Optional[float], Dict[str, Any]]:
        """
        Run the evaluator.

        Returns:
            Tuple of (score, extra_data_dict) or (None, {}) on failure
        """
        eval_arg = "" if is_baseline else candidate_id

        cmd = [self.config.python_cmd]

        # Add memory wrapper if configured
        if self.config.memory_limit_mb > 0:
            wrapper_path = SCRIPT_DIR / "memory_limit_wrapper.py"
            cmd.extend([str(wrapper_path), str(self.config.memory_limit_mb)])

        cmd.extend([self.config.evaluator_path, eval_arg])

        log(f"Running evaluator: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.config.timeout_seconds,
                cwd=self.config.evolution_dir
            )

            if result.returncode != 0:
                log_error(f"Evaluator failed: {result.stderr}")
                return None, {}

            output = result.stdout + result.stderr
            return self._parse_evaluator_output(output)

        except subprocess.TimeoutExpired:
            log_error("Evaluator timed out")
            return None, {}
        except Exception as e:
            log_error(f"Evaluator error: {e}")
            return None, {}

    def _parse_evaluator_output(self, output: str) -> Tuple[Optional[float], Dict[str, Any]]:
        """
        Parse evaluator output for score.

        Supports:
        - Simple numeric value
        - JSON with 'performance' or 'score' field
        - SCORE: prefix (legacy)
        """
        score = None
        json_data = {}

        for line in output.strip().split('\n'):
            line = line.strip()

            # Try JSON first
            if line.startswith('{'):
                try:
                    data = json.loads(line)
                    json_data = data
                    if 'performance' in data:
                        score = float(data['performance'])
                    elif 'score' in data:
                        score = float(data['score'])
                    break
                except (json.JSONDecodeError, ValueError):
                    pass

            # Try simple numeric
            if score is None and line and not line.startswith('{'):
                try:
                    score = float(line)
                    break
                except ValueError:
                    pass

        # Try SCORE: prefix (legacy)
        if score is None:
            match = re.search(r'^SCORE:\s*([+-]?\d*\.?\d+)', output, re.MULTILINE)
            if match:
                try:
                    score = float(match.group(1))
                except ValueError:
                    pass

        return score, json_data

    def process_candidate(self, candidate: Candidate) -> int:
        """
        Process a single candidate.

        Returns:
            Exit code (0=success, 77=AI failed, 78=missing parent, etc.)
        """
        self.current_candidate_id = candidate.id
        log(f"Processing: {candidate.id}")
        log(f"Description: {candidate.description[:80]}..." if len(candidate.description) > 80 else f"Description: {candidate.description}")
        log(f"Based on: {candidate.based_on_id or 'baseline'}")

        is_baseline = self._is_baseline(candidate.id, candidate.based_on_id)
        target_file = Path(self.config.output_dir) / f"evolution_{candidate.id}.py"

        # Resolve parent
        resolved_parent, source_file = self._resolve_parent_id(candidate.based_on_id)

        if source_file is None and not is_baseline:
            log_error(f"Parent not found: {candidate.based_on_id}")
            return 78  # Missing parent

        if source_file is None:
            source_file = Path(self.config.algorithm_path)

        # Check if target already exists
        if target_file.exists():
            log("File already exists, running evaluation only")
        elif not is_baseline:
            # Copy source to target
            log(f"Copying {source_file.name} to {target_file.name}")
            shutil.copy(source_file, target_file)

            # Call AI to modify (uses round-based retry with backoff)
            prompt = self._build_prompt(candidate, target_file.name)
            success, model = self._call_ai_with_backoff(prompt, target_file)

            if not success:
                log_error("AI failed after all retries")
                target_file.unlink(missing_ok=True)
                return 77  # AI generation failed

            # Record model used
            if model:
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.update_candidate_field(candidate.id, 'run-LLM', model)

            # Check syntax
            if not self._check_syntax(target_file):
                log_error("Syntax error in generated file")
                target_file.unlink(missing_ok=True)
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.update_candidate_status(candidate.id, 'pending')
                return 0  # Will retry

            # Run validator with retry loop
            # AIDEV-NOTE: Validator catches structural errors before expensive full evaluation.
            # If validation fails, we give the AI feedback and ask it to fix the code.
            validation_passed = False
            for validation_attempt in range(self.config.max_validation_retries + 1):
                valid, error_info = self._run_validator(candidate.id)

                if valid:
                    validation_passed = True
                    break

                if validation_attempt >= self.config.max_validation_retries:
                    log_error(f"Validation failed after {self.config.max_validation_retries} fix attempts")
                    break

                # Ask AI to fix the validation error
                log(f"Validation failed (attempt {validation_attempt + 1}), asking AI to fix...")
                fix_prompt = self._build_fix_prompt(candidate, target_file.name, error_info)
                success, fix_model = self._call_ai_with_backoff(fix_prompt, target_file)

                if not success:
                    log_error("AI failed to fix validation error")
                    break

                # Record that we used an additional model call for fixing
                if fix_model:
                    with EvolutionCSV(self.config.csv_path) as csv:
                        current_llm = csv.get_candidate_info(candidate.id).get('run-LLM', '')
                        new_llm = f"{current_llm}+{fix_model}" if current_llm else fix_model
                        csv.update_candidate_field(candidate.id, 'run-LLM', new_llm)

                # Re-check syntax after fix
                if not self._check_syntax(target_file):
                    log_error("Fix introduced syntax error")
                    # Don't break - try again if we have retries left

            if not validation_passed:
                # Validation failed after all retries
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.update_candidate_status(candidate.id, 'failed-validation')
                    # Store the last error for debugging
                    if error_info:
                        error_summary = f"{error_info.get('error_type', 'unknown')}: {error_info.get('error', '')[:100]}"
                        csv.update_candidate_field(candidate.id, 'validation_error', error_summary)
                return 1

        # Run evaluator
        log("Running evaluator...")
        score, json_data = self._run_evaluator(candidate.id, is_baseline)

        if score is None:
            log_error("Evaluation failed - no score")
            with EvolutionCSV(self.config.csv_path) as csv:
                csv.update_candidate_status(candidate.id, 'failed')
            return 1

        log(f"Score: {score}")

        # Update CSV
        with EvolutionCSV(self.config.csv_path) as csv:
            csv.update_candidate_status(candidate.id, 'complete')
            csv.update_candidate_performance(candidate.id, str(score))

            # Update any extra fields from JSON
            for key, value in json_data.items():
                if key not in ('performance', 'score'):
                    csv.update_candidate_field(candidate.id, key, str(value))

        self.current_candidate_id = None
        return 0

    def run(self) -> int:
        """
        Main worker loop.

        Returns:
            Exit code
        """
        log(f"Started (max {self.config.max_candidates} candidates)")
        processed = 0

        while processed < self.config.max_candidates:
            # Get next pending candidate
            with EvolutionCSV(self.config.csv_path) as csv:
                result = csv.get_next_pending_candidate()

            if not result:
                log("No pending candidates")
                break

            candidate_id, _ = result

            # Get full candidate info
            with EvolutionCSV(self.config.csv_path) as csv:
                info = csv.get_candidate_info(candidate_id)

            if not info:
                log_warn(f"Candidate info not found: {candidate_id}")
                continue

            candidate = Candidate(
                id=info['id'],
                based_on_id=info.get('basedOnId', ''),
                description=info.get('description', '')
            )

            exit_code = self.process_candidate(candidate)
            processed += 1

            if exit_code == 77:  # AI failed
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.update_candidate_status(candidate.id, 'failed-ai-retry')
            elif exit_code == 78:  # Missing parent
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.update_candidate_status(candidate.id, 'failed-parent-missing')
            elif exit_code == 2:  # Rate limit
                return 2
            elif exit_code == 3:  # API exhausted
                return 3

            log(f"Processed {processed}/{self.config.max_candidates}")

        log("Exiting")
        return 0


def load_config_from_yaml(config_path: Optional[str] = None) -> Config:
    """Load configuration from YAML file."""
    import yaml

    # Find config file
    if config_path:
        yaml_path = Path(config_path)
    elif os.environ.get('CLAUDE_EVOLVE_CONFIG'):
        yaml_path = Path(os.environ['CLAUDE_EVOLVE_CONFIG'])
    else:
        # Look for config.yaml in evolution directory
        yaml_path = Path('evolution/config.yaml')
        if not yaml_path.exists():
            yaml_path = Path('config.yaml')

    if not yaml_path.exists():
        raise FileNotFoundError(f"Config not found: {yaml_path}")

    with open(yaml_path) as f:
        data = yaml.safe_load(f) or {}

    # Resolve paths relative to config file
    base_dir = yaml_path.parent

    def resolve(path: str) -> str:
        p = Path(path)
        if not p.is_absolute():
            p = base_dir / p
        return str(p.resolve())

    ideation = data.get('ideation', {})

    return Config(
        csv_path=resolve(data.get('csv_file', 'evolution.csv')),
        evolution_dir=str(base_dir.resolve()),
        output_dir=resolve(data.get('output_dir', '.')),
        algorithm_path=resolve(data.get('algorithm_file', 'algorithm.py')),
        evaluator_path=resolve(data.get('evaluator_file', 'evaluator.py')),
        brief_path=resolve(data.get('brief_file', 'BRIEF.md')),
        python_cmd=data.get('python_cmd', 'python3'),
        memory_limit_mb=data.get('memory_limit_mb', 0),
        timeout_seconds=data.get('timeout_seconds', 600),
        max_candidates=data.get('worker_max_candidates', 5),
        max_validation_retries=data.get('max_validation_retries', 3),
        max_rounds=ideation.get('max_rounds', 10),
        initial_wait=ideation.get('initial_wait', 60),
        max_wait=ideation.get('max_wait', 600)
    )


def main():
    parser = argparse.ArgumentParser(description='Claude Evolve Worker')
    parser.add_argument('--config', help='Path to config.yaml')
    parser.add_argument('--timeout', type=int, help='Timeout in seconds')
    args = parser.parse_args()

    try:
        config = load_config_from_yaml(args.config)
        if args.timeout:
            config.timeout_seconds = args.timeout

        worker = Worker(config)
        sys.exit(worker.run())

    except FileNotFoundError as e:
        log_error(f"Config error: {e}")
        sys.exit(1)
    except Exception as e:
        log_error(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
