#!/usr/bin/env python3
"""
Main orchestrator for claude-evolve.
Manages worker processes and coordinates ideation.

AIDEV-NOTE: This is the Python port of bin/claude-evolve-run.
Exit codes:
  0 - Success (evolution complete)
  1 - Error
  2 - Rate limit (workers should retry later)
  3 - API exhausted
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set

# Add lib to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from lib.evolution_csv import EvolutionCSV
from lib.log import log, log_error, log_warn, set_prefix
from lib.meta_learning import process_new_generations
set_prefix("RUN")


@dataclass
class RunConfig:
    """Configuration for the run orchestrator."""
    csv_path: str
    evolution_dir: str
    brief_path: str = ""
    max_workers: int = 4
    auto_ideate: bool = True
    meta_learning: bool = True  # Enable meta-learning notes
    worker_timeout: int = 600
    poll_interval: int = 5
    min_completed_for_ideation: int = 3
    config_path: Optional[str] = None


class WorkerPool:
    """Manages worker subprocess pool."""

    def __init__(self, max_workers: int, worker_script: Path, config_path: Optional[str], timeout: int):
        self.max_workers = max_workers
        self.worker_script = worker_script
        self.config_path = config_path
        self.timeout = timeout
        self.workers: dict[int, subprocess.Popen] = {}  # pid -> process

    def spawn_worker(self) -> Optional[int]:
        """Spawn a new worker. Returns pid or None if at capacity."""
        if len(self.workers) >= self.max_workers:
            return None

        # Use -u for unbuffered output so logs stream in real-time
        cmd = [sys.executable, '-u', str(self.worker_script)]
        if self.config_path:
            cmd.extend(['--config', self.config_path])
        if self.timeout:
            cmd.extend(['--timeout', str(self.timeout)])

        try:
            # Don't capture output - let it stream directly to terminal
            # This provides real-time visibility into which models are being used
            proc = subprocess.Popen(cmd)
            self.workers[proc.pid] = proc
            log(f"Spawned worker {proc.pid}")
            return proc.pid
        except Exception as e:
            log_error(f"Failed to spawn worker: {e}")
            return None

    def cleanup_finished(self) -> List[int]:
        """Clean up finished workers. Returns list of exit codes."""
        exit_codes = []
        finished_pids = []

        for pid, proc in list(self.workers.items()):
            ret = proc.poll()
            if ret is not None:
                finished_pids.append(pid)
                exit_codes.append(ret)
                log(f"Worker {pid} exited with code {ret}")

        for pid in finished_pids:
            del self.workers[pid]

        return exit_codes

    def shutdown(self, timeout: int = 10):
        """Shutdown all workers gracefully."""
        if not self.workers:
            return

        log(f"Shutting down {len(self.workers)} workers...")

        # Send SIGTERM
        for pid, proc in self.workers.items():
            try:
                proc.terminate()
            except Exception:
                pass

        # Wait for graceful shutdown
        deadline = time.time() + timeout
        while self.workers and time.time() < deadline:
            self.cleanup_finished()
            if self.workers:
                time.sleep(0.5)

        # Force kill remaining
        for pid, proc in list(self.workers.items()):
            try:
                proc.kill()
                log(f"Force killed worker {pid}")
            except Exception:
                pass

        self.workers.clear()

    @property
    def active_count(self) -> int:
        return len(self.workers)


class EvolutionRunner:
    """Main evolution orchestrator."""

    def __init__(self, config: RunConfig):
        self.config = config
        self.worker_script = SCRIPT_DIR / "evolve_worker.py"
        self.ideate_script = SCRIPT_DIR / "evolve_ideate.py"
        self.pool = WorkerPool(
            max_workers=config.max_workers,
            worker_script=self.worker_script,
            config_path=config.config_path,
            timeout=config.worker_timeout
        )
        self.api_limit_reached = False
        self.shutdown_requested = False
        self._setup_signal_handlers()

    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown."""
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        """Handle termination signal."""
        sig_name = signal.Signals(signum).name
        log(f"Received {sig_name}, shutting down...")
        self.shutdown_requested = True
        self.pool.shutdown()
        sys.exit(128 + signum)

    def cleanup_csv(self):
        """Clean up CSV at startup."""
        log("Cleaning up CSV...")
        with EvolutionCSV(self.config.csv_path) as csv:
            # Remove duplicates
            removed = csv.remove_duplicate_candidates()
            if removed:
                log(f"Removed {removed} duplicate candidates")

            # Reset stuck candidates
            reset = csv.reset_stuck_candidates()
            if reset:
                log(f"Reset {reset} stuck candidates")

            # Clean corrupted status fields
            fixed = csv.cleanup_corrupted_status_fields()
            if fixed:
                log(f"Fixed {fixed} corrupted status fields")

    def ensure_baseline(self):
        """Ensure baseline entry exists in CSV."""
        with EvolutionCSV(self.config.csv_path) as csv:
            info = csv.get_candidate_info('baseline-000')
            if not info:
                log("Adding baseline-000 entry")
                csv.append_candidates([{
                    'id': 'baseline-000',
                    'basedOnId': '',
                    'description': 'Original algorithm.py performance',
                    'status': 'pending'
                }])

    def get_stats(self) -> dict:
        """Get CSV statistics."""
        with EvolutionCSV(self.config.csv_path) as csv:
            return csv.get_csv_stats()

    def should_ideate(self, stats: dict) -> bool:
        """Check if we should run ideation."""
        if not self.config.auto_ideate:
            return False

        # Need minimum completed algorithms to learn from
        if stats['complete'] < self.config.min_completed_for_ideation:
            log(f"Not enough completed ({stats['complete']} < {self.config.min_completed_for_ideation})")
            return False

        return True

    def run_ideation(self) -> bool:
        """Run ideation. Returns True on success."""
        log("Running ideation...")

        cmd = [sys.executable, str(self.ideate_script)]
        if self.config.config_path:
            cmd.extend(['--config', self.config.config_path])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.config.evolution_dir
            )

            # Forward ideation output (already has timestamps from ideate module)
            if result.stdout:
                for line in result.stdout.strip().split('\n'):
                    print(line, file=sys.stderr, flush=True)
            if result.stderr:
                for line in result.stderr.strip().split('\n'):
                    print(line, file=sys.stderr, flush=True)

            return result.returncode == 0

        except Exception as e:
            log_error(f"Ideation failed: {e}")
            return False

    def run(self) -> int:
        """
        Main orchestration loop.

        Returns:
            Exit code
        """
        log("Starting evolution run")
        log(f"Max workers: {self.config.max_workers}")
        log(f"Auto ideate: {self.config.auto_ideate}")

        # Startup cleanup
        self.cleanup_csv()
        self.ensure_baseline()

        iteration = 0

        while not self.shutdown_requested:
            iteration += 1

            # Clean up finished workers
            exit_codes = self.pool.cleanup_finished()

            # Check for API limit
            if 2 in exit_codes or 3 in exit_codes:
                log("API limit reached, waiting 5 minutes...")
                self.api_limit_reached = True
                time.sleep(300)  # 5 minute wait
                self.api_limit_reached = False
                self.cleanup_csv()  # Reset stuck candidates
                continue

            # Periodic cleanup (every 5 iterations)
            if iteration % 5 == 0 and self.pool.active_count == 0:
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.reset_stuck_candidates()

            # Get stats
            stats = self.get_stats()
            log(f"Stats: {stats['pending']} pending, {stats['complete']} complete, {stats['running']} running")

            # Check if we need ideation
            if stats['pending'] == 0 and self.pool.active_count == 0:
                # First reset any stuck candidates
                with EvolutionCSV(self.config.csv_path) as csv:
                    csv.reset_stuck_candidates()

                # Re-check stats after reset
                stats = self.get_stats()

                if stats['pending'] == 0:
                    if self.should_ideate(stats):
                        # Process meta-learning before ideation
                        # AIDEV-NOTE: This updates BRIEF-notes.md with learnings from completed generations
                        if self.config.meta_learning and self.config.brief_path:
                            try:
                                processed = process_new_generations(
                                    self.config.csv_path,
                                    self.config.evolution_dir,
                                    self.config.brief_path
                                )
                                if processed > 0:
                                    log(f"Meta-learning: processed {processed} generation(s)")
                            except Exception as e:
                                log_warn(f"Meta-learning failed: {e}")

                        if self.run_ideation():
                            continue  # Loop back to check for new work
                        else:
                            log_warn("Ideation failed, waiting...")
                            time.sleep(30)
                            continue
                    else:
                        log("Evolution complete!")
                        break

            # Spawn workers for pending work
            while stats['pending'] > 0 and self.pool.active_count < self.config.max_workers:
                pid = self.pool.spawn_worker()
                if pid is None:
                    break
                stats['pending'] -= 1  # Optimistic decrement

            # Sleep before next iteration
            time.sleep(self.config.poll_interval)

        # Cleanup
        self.pool.shutdown()
        log("Exiting")
        return 0


def load_config(config_path: Optional[str] = None) -> RunConfig:
    """Load configuration from YAML."""
    import yaml

    # Find config
    if config_path:
        yaml_path = Path(config_path)
    elif os.environ.get('CLAUDE_EVOLVE_CONFIG'):
        yaml_path = Path(os.environ['CLAUDE_EVOLVE_CONFIG'])
    else:
        yaml_path = Path('evolution/config.yaml')
        if not yaml_path.exists():
            yaml_path = Path('config.yaml')

    if not yaml_path.exists():
        raise FileNotFoundError(f"Config not found: {yaml_path}")

    with open(yaml_path) as f:
        data = yaml.safe_load(f) or {}

    base_dir = yaml_path.parent

    def resolve(path: str) -> str:
        p = Path(path)
        if not p.is_absolute():
            p = base_dir / p
        return str(p.resolve())

    parallel = data.get('parallel', {})

    return RunConfig(
        csv_path=resolve(data.get('csv_file', 'evolution.csv')),
        evolution_dir=str(base_dir.resolve()),
        brief_path=resolve(data.get('brief_file', 'BRIEF.md')),
        max_workers=parallel.get('max_workers', 4),
        auto_ideate=data.get('auto_ideate', True),
        meta_learning=data.get('meta_learning', True),
        worker_timeout=data.get('timeout_seconds', 600),
        poll_interval=parallel.get('poll_interval', 5),
        min_completed_for_ideation=data.get('min_completed_for_ideation', 3),
        config_path=str(yaml_path.resolve())
    )


def main():
    parser = argparse.ArgumentParser(description='Claude Evolve Runner')
    parser.add_argument('--config', help='Path to config.yaml')
    parser.add_argument('--parallel', type=int, help='Max parallel workers')
    parser.add_argument('--sequential', action='store_true', help='Run sequentially (1 worker)')
    parser.add_argument('--timeout', type=int, help='Worker timeout in seconds')
    args = parser.parse_args()

    try:
        config = load_config(args.config)

        if args.sequential:
            config.max_workers = 1
        elif args.parallel:
            config.max_workers = args.parallel

        if args.timeout:
            config.worker_timeout = args.timeout

        runner = EvolutionRunner(config)
        sys.exit(runner.run())

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
