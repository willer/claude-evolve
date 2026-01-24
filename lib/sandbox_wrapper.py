#!/usr/bin/env python3
"""
Sandbox wrapper for claude-evolve evaluations.

Provides multiple layers of isolation:
1. macOS sandbox-exec: restricts file access, blocks network
2. Memory limits: via resource module and process monitoring
3. CPU time limits: via resource module

AIDEV-NOTE: This is the main entry point for sandboxed evaluation.
On non-macOS systems, falls back to memory limits only.
"""
import os
import platform
import resource
import subprocess
import sys
import threading
import time
import signal
from pathlib import Path
from typing import Optional, Tuple, List

SCRIPT_DIR = Path(__file__).parent
SANDBOX_PROFILE = SCRIPT_DIR / "sandbox.sb"


def is_macos() -> bool:
    """Check if running on macOS."""
    return platform.system() == "Darwin"


def sandbox_exec_available() -> bool:
    """Check if sandbox-exec is available."""
    if not is_macos():
        return False
    try:
        result = subprocess.run(
            ["which", "sandbox-exec"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False


def set_resource_limits(memory_mb: int, cpu_seconds: int):
    """
    Set resource limits for the current process.
    These are inherited by child processes.
    """
    if memory_mb > 0:
        limit_bytes = memory_mb * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
        except (OSError, ValueError) as e:
            print(f"[SANDBOX] Warning: Could not set memory limit: {e}", file=sys.stderr)

    if cpu_seconds > 0:
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        except (OSError, ValueError) as e:
            print(f"[SANDBOX] Warning: Could not set CPU limit: {e}", file=sys.stderr)


def get_process_tree_memory(pid: int) -> float:
    """Get total memory usage of process tree in MB."""
    try:
        pgid = os.getpgid(pid)
        result = subprocess.run(
            ["ps", "-o", "rss=", "-g", str(pgid)],
            capture_output=True,
            text=True,
            timeout=1
        )
        if result.returncode != 0:
            return 0.0

        total_kb = sum(
            int(line.strip())
            for line in result.stdout.strip().split('\n')
            if line.strip().isdigit()
        )
        return total_kb / 1024.0
    except Exception:
        return 0.0


def monitor_and_kill(process: subprocess.Popen, memory_mb: int) -> Optional[str]:
    """Monitor process memory and kill if exceeded."""
    while process.poll() is None:
        try:
            mem_used = get_process_tree_memory(process.pid)
            if mem_used > memory_mb:
                print(f"[SANDBOX] Memory limit exceeded: {mem_used:.1f}MB > {memory_mb}MB", file=sys.stderr)
                try:
                    pgid = os.getpgid(process.pid)
                    os.killpg(pgid, signal.SIGTERM)
                    time.sleep(2)
                    if process.poll() is None:
                        os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                return f"Memory limit exceeded: {mem_used:.1f}MB"
            time.sleep(0.1)
        except Exception:
            time.sleep(0.1)
    return None


def build_sandbox_command(
    command: List[str],
    evolution_dir: str,
    use_sandbox: bool = True
) -> List[str]:
    """
    Build the sandboxed command.

    Args:
        command: The command to run (e.g., ["python3", "evaluator.py", "gen01-001"])
        evolution_dir: Path to the evolution directory (will have read/write access)
        use_sandbox: Whether to use sandbox-exec (if available)

    Returns:
        The full command with sandbox wrapper if applicable
    """
    if not use_sandbox or not sandbox_exec_available():
        return command

    home_dir = str(Path.home())

    sandbox_cmd = [
        "sandbox-exec",
        "-f", str(SANDBOX_PROFILE),
        "-D", f"EVOLUTION_DIR={evolution_dir}",
        "-D", f"HOME={home_dir}",
    ]

    return sandbox_cmd + command


def make_child_preexec(memory_mb: int, cpu_seconds: int):
    """
    Create a preexec_fn that sets resource limits and creates a new session.

    AIDEV-NOTE: Resource limits MUST be set in the child process via preexec_fn,
    not in the parent. Setting them in the parent would limit the worker itself.
    """
    def child_setup():
        # Create new session/process group for cleanup
        os.setsid()
        # Apply resource limits only to this child process
        set_resource_limits(memory_mb, cpu_seconds)
    return child_setup


def run_sandboxed(
    command: List[str],
    evolution_dir: str,
    memory_mb: int = 0,
    cpu_seconds: int = 0,
    timeout_seconds: int = 600,
    use_sandbox: bool = True
) -> Tuple[int, str, str]:
    """
    Run a command with sandboxing.

    Args:
        command: Command to run
        evolution_dir: Directory to allow access to
        memory_mb: Memory limit in MB (0 = unlimited)
        cpu_seconds: CPU time limit in seconds (0 = unlimited)
        timeout_seconds: Wall-clock timeout
        use_sandbox: Whether to use sandbox-exec

    Returns:
        Tuple of (return_code, stdout, stderr)
    """
    full_cmd = build_sandbox_command(command, evolution_dir, use_sandbox)

    sandbox_active = "sandbox-exec" in full_cmd
    print(f"[SANDBOX] {'Enabled' if sandbox_active else 'Disabled (not available)'}", file=sys.stderr)
    print(f"[SANDBOX] Memory limit: {memory_mb}MB" if memory_mb > 0 else "[SANDBOX] Memory limit: unlimited", file=sys.stderr)
    print(f"[SANDBOX] CPU limit: {cpu_seconds}s" if cpu_seconds > 0 else "[SANDBOX] CPU limit: unlimited", file=sys.stderr)
    print(f"[SANDBOX] Directory: {evolution_dir}", file=sys.stderr)
    print(f"[SANDBOX] Command: {' '.join(command)}", file=sys.stderr)

    try:
        # AIDEV-NOTE: Resource limits are set via preexec_fn so they only apply
        # to the child process, not the parent worker
        process = subprocess.Popen(
            full_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=evolution_dir,
            preexec_fn=make_child_preexec(memory_mb, cpu_seconds)
        )

        # Start memory monitor in background
        memory_error = None
        if memory_mb > 0:
            def monitor():
                nonlocal memory_error
                memory_error = monitor_and_kill(process, memory_mb)

            monitor_thread = threading.Thread(target=monitor, daemon=True)
            monitor_thread.start()

        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            print(f"[SANDBOX] Timeout after {timeout_seconds}s", file=sys.stderr)
            try:
                pgid = os.getpgid(process.pid)
                os.killpg(pgid, signal.SIGTERM)
                time.sleep(2)
                if process.poll() is None:
                    os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            return 124, "", f"Timeout after {timeout_seconds} seconds"

        if memory_error:
            return 137, "", memory_error

        return process.returncode, stdout.decode('utf-8', errors='replace'), stderr.decode('utf-8', errors='replace')

    except FileNotFoundError:
        return 127, "", f"Command not found: {full_cmd[0]}"
    except Exception as e:
        return 1, "", f"Error: {e}"


def main():
    """
    CLI entry point.

    Usage: sandbox_wrapper.py [options] <evolution_dir> -- <command...>

    Options:
        --memory-mb <MB>      Memory limit in MB (default: 0 = unlimited)
        --cpu-seconds <S>     CPU time limit (default: 0 = unlimited)
        --timeout <S>         Wall-clock timeout (default: 600)
        --no-sandbox          Disable sandbox-exec (memory limits still apply)

    Note: Use -- to separate wrapper options from the command, especially
    if the command has its own options (like python3 -c "...").
    """
    import argparse

    parser = argparse.ArgumentParser(
        description='Run command in sandbox with resource limits',
        usage='%(prog)s [options] evolution_dir -- command [args...]'
    )
    parser.add_argument('--memory-mb', type=int, default=0,
                       help='Memory limit in MB (0=unlimited)')
    parser.add_argument('--cpu-seconds', type=int, default=0,
                       help='CPU time limit in seconds (0=unlimited)')
    parser.add_argument('--timeout', type=int, default=600,
                       help='Wall-clock timeout in seconds')
    parser.add_argument('--no-sandbox', action='store_true',
                       help='Disable sandbox-exec isolation')
    parser.add_argument('evolution_dir',
                       help='Evolution directory (will have read/write access)')
    parser.add_argument('command', nargs=argparse.REMAINDER,
                       help='Command to run (use -- before command if it has options)')

    args = parser.parse_args()

    # Handle the case where command starts with '--'
    command = args.command
    if command and command[0] == '--':
        command = command[1:]

    if not command:
        parser.error("No command specified")

    args.command = command

    # Verify evolution_dir exists
    evolution_dir = Path(args.evolution_dir).resolve()
    if not evolution_dir.is_dir():
        print(f"Error: Not a directory: {evolution_dir}", file=sys.stderr)
        sys.exit(1)

    returncode, stdout, stderr = run_sandboxed(
        command=args.command,
        evolution_dir=str(evolution_dir),
        memory_mb=args.memory_mb,
        cpu_seconds=args.cpu_seconds,
        timeout_seconds=args.timeout,
        use_sandbox=not args.no_sandbox
    )

    # Output results
    if stdout:
        print(stdout, end='')
    if stderr:
        print(stderr, file=sys.stderr, end='')

    sys.exit(returncode)


if __name__ == "__main__":
    main()
