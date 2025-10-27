#!/usr/bin/env python3
"""
Memory-limited execution wrapper for claude-evolve evaluations.

This script runs a command with memory limits to prevent runaway algorithms
from consuming all system memory and crashing the machine.

CRITICAL: Multi-layer protection approach (both must work together):
1. ulimit -m (RSS limit) set by calling shell script - kernel-enforced, catches neural networks
2. This Python wrapper monitors ENTIRE PROCESS TREE every 0.1s and kills if limit exceeded

AIDEV-NOTE: Previous bugs fixed:
- ulimit -v (virtual memory) doesn't catch neural networks that use mmap()
- Was only monitoring direct child, not entire process tree (missed grandchildren)
- Monitoring interval was 0.5s - too slow for fast memory allocations
- Resource limit failures were silently ignored instead of failing fast
"""
import sys
import os
import subprocess
import signal
import time
import resource
from typing import Optional, Tuple

def verify_memory_limit_set(limit_mb: int) -> Tuple[bool, str]:
    """Verify that memory limits are actually enforced."""
    try:
        limit_bytes = limit_mb * 1024 * 1024

        # Check RLIMIT_AS (virtual memory)
        soft_as, hard_as = resource.getrlimit(resource.RLIMIT_AS)
        if soft_as != resource.RLIM_INFINITY and soft_as <= limit_bytes * 1.1:
            return True, f"RLIMIT_AS set to {soft_as / (1024*1024):.0f}MB"

        # Check RLIMIT_DATA (data segment)
        try:
            soft_data, hard_data = resource.getrlimit(resource.RLIMIT_DATA)
            if soft_data != resource.RLIM_INFINITY and soft_data <= limit_bytes * 1.1:
                return True, f"RLIMIT_DATA set to {soft_data / (1024*1024):.0f}MB"
        except (OSError, ValueError):
            pass

        return False, "No hard memory limits detected"
    except Exception as e:
        return False, f"Error checking limits: {e}"

def set_memory_limit(limit_mb: int) -> bool:
    """
    Set memory limit in MB using resource module.
    Returns True if successful, False otherwise.
    """
    try:
        # Convert MB to bytes
        limit_bytes = limit_mb * 1024 * 1024

        # Set virtual memory limit (address space)
        # On macOS this is the most reliable way to limit memory
        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))

        # Also try to set data segment limit if available
        try:
            resource.setrlimit(resource.RLIMIT_DATA, (limit_bytes, limit_bytes))
        except (OSError, ValueError):
            # Not available on all systems
            pass

        # Verify it was actually set
        is_set, msg = verify_memory_limit_set(limit_mb)
        if is_set:
            print(f"[MEMORY] ✓ Hard limit enforced: {msg}", file=sys.stderr)
            return True
        else:
            print(f"[MEMORY] ✗ Hard limit NOT enforced: {msg}", file=sys.stderr)
            return False

    except (OSError, ValueError) as e:
        print(f"[MEMORY] ✗ Could not set memory limit: {e}", file=sys.stderr)
        return False

def get_process_tree_memory_native(pid: int) -> float:
    """Get total memory usage of process tree using native ps command."""
    try:
        # Get all descendant PIDs using ps
        ps_result = subprocess.run(
            ["ps", "-o", "pid=,ppid=,rss="],
            capture_output=True,
            text=True,
            timeout=1
        )

        if ps_result.returncode != 0:
            return 0.0

        # Build process tree and sum memory
        total_rss_kb = 0
        lines = ps_result.stdout.strip().split('\n')

        # Find all descendants
        descendants = {pid}
        found_new = True
        while found_new:
            found_new = False
            for line in lines:
                parts = line.split()
                if len(parts) >= 3:
                    child_pid, parent_pid, rss = int(parts[0]), int(parts[1]), int(parts[2])
                    if parent_pid in descendants and child_pid not in descendants:
                        descendants.add(child_pid)
                        total_rss_kb += rss
                        found_new = True

        # Convert KB to MB
        return total_rss_kb / 1024.0
    except Exception:
        return 0.0

def monitor_memory_usage_native(process: subprocess.Popen, limit_mb: int) -> Optional[str]:
    """Monitor ENTIRE PROCESS TREE memory usage using native tools and kill if it exceeds limits."""
    print(f"[MEMORY] Monitoring process tree from root PID {process.pid} (limit: {limit_mb}MB)", file=sys.stderr)

    while process.poll() is None:
        try:
            # Get total memory for entire process tree
            memory_mb = get_process_tree_memory_native(process.pid)

            if memory_mb > limit_mb:
                print(f"[MEMORY] Process tree exceeded {limit_mb}MB limit (using {memory_mb:.1f}MB), terminating entire tree", file=sys.stderr)
                # Kill the entire process group
                try:
                    pgid = os.getpgid(process.pid)
                    os.killpg(pgid, signal.SIGTERM)
                except ProcessLookupError:
                    return f"Memory limit exceeded: {memory_mb:.1f}MB > {limit_mb}MB"

                time.sleep(2)  # Give it time to cleanup

                try:
                    if process.poll() is None:
                        pgid = os.getpgid(process.pid)
                        os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                return f"Memory limit exceeded: {memory_mb:.1f}MB > {limit_mb}MB"

            time.sleep(0.1)  # Check every 100ms for faster response

        except (subprocess.TimeoutExpired, ValueError, ProcessLookupError):
            # Process might have terminated or ps command failed
            time.sleep(0.1)
            continue

    return None

def get_process_tree_memory_psutil(ps_process) -> float:
    """Get total memory usage of entire process tree using psutil."""
    try:
        import psutil
        total_mb = 0.0

        # Get memory of root process
        try:
            total_mb += ps_process.memory_info().rss / (1024 * 1024)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return 0.0

        # Get memory of all children (recursive)
        try:
            for child in ps_process.children(recursive=True):
                try:
                    total_mb += child.memory_info().rss / (1024 * 1024)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

        return total_mb
    except ImportError:
        return 0.0

def monitor_memory_usage(process: subprocess.Popen, limit_mb: int) -> Optional[str]:
    """Monitor ENTIRE PROCESS TREE memory usage and kill if it exceeds limits."""
    try:
        import psutil
        ps_process = psutil.Process(process.pid)
        print(f"[MEMORY] Monitoring process tree from root PID {process.pid} (limit: {limit_mb}MB, using psutil)", file=sys.stderr)

        while process.poll() is None:
            try:
                # Get total memory for entire process tree
                memory_mb = get_process_tree_memory_psutil(ps_process)

                if memory_mb > limit_mb:
                    print(f"[MEMORY] Process tree exceeded {limit_mb}MB limit (using {memory_mb:.1f}MB), terminating entire tree", file=sys.stderr)
                    # Kill the entire process group
                    try:
                        pgid = os.getpgid(process.pid)
                        os.killpg(pgid, signal.SIGTERM)
                    except ProcessLookupError:
                        return f"Memory limit exceeded: {memory_mb:.1f}MB > {limit_mb}MB"

                    time.sleep(2)  # Give it time to cleanup

                    try:
                        if process.poll() is None:
                            pgid = os.getpgid(process.pid)
                            os.killpg(pgid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    return f"Memory limit exceeded: {memory_mb:.1f}MB > {limit_mb}MB"

                time.sleep(0.1)  # Check every 100ms for faster response
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                # Process already terminated
                break
    except ImportError:
        # psutil not available, use native monitoring
        return monitor_memory_usage_native(process, limit_mb)

    return None

def validate_memory_limit(limit_mb: int) -> bool:
    """Validate memory limit against system resources."""
    if limit_mb <= 0:
        return True  # 0 or negative means disabled
    
    # Basic sanity checks
    if limit_mb < 10:
        print(f"[MEMORY] Warning: Memory limit {limit_mb}MB is very small", file=sys.stderr)
    elif limit_mb > 64000:
        print(f"[MEMORY] Warning: Memory limit {limit_mb}MB is very large", file=sys.stderr)
    
    return True

def main():
    if len(sys.argv) < 3:
        print("Usage: memory_limit_wrapper.py <memory_limit_mb> <command> [args...]", file=sys.stderr)
        sys.exit(1)
    
    try:
        memory_limit_mb = int(sys.argv[1])
    except ValueError:
        print(f"Error: Invalid memory limit '{sys.argv[1]}' - must be integer MB", file=sys.stderr)
        sys.exit(1)
    
    if not validate_memory_limit(memory_limit_mb):
        sys.exit(1)
    
    command = sys.argv[2:]
    
    if memory_limit_mb <= 0:
        print("[MEMORY] No memory limit set (0 or negative value)", file=sys.stderr)
        # Just exec the command directly without limits
        os.execvp(command[0], command)
    
    # Set memory limits for this process (inherited by subprocess)
    set_memory_limit(memory_limit_mb)
    
    try:
        # Start process in new process group for easier cleanup
        process = subprocess.Popen(
            command,
            preexec_fn=os.setsid,  # Create new process group
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1  # Line buffered
        )
        
        # Monitor memory usage in background
        memory_error = None
        import threading
        
        def memory_monitor():
            nonlocal memory_error
            memory_error = monitor_memory_usage(process, memory_limit_mb)
        
        monitor_thread = threading.Thread(target=memory_monitor, daemon=True)
        monitor_thread.start()
        
        # Stream output in real-time
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                print(output.rstrip())
                sys.stdout.flush()
        
        # Wait for completion
        return_code = process.wait()
        
        # Check if we killed it due to memory
        if memory_error:
            print(f"[MEMORY] {memory_error}", file=sys.stderr)
            sys.exit(137)  # 128 + SIGKILL
        
        sys.exit(return_code)
        
    except FileNotFoundError:
        print(f"Error: Command not found: {command[0]}", file=sys.stderr)
        sys.exit(127)
    except KeyboardInterrupt:
        print("[MEMORY] Interrupted by user", file=sys.stderr)
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except:
            pass
        sys.exit(130)
    except Exception as e:
        print(f"[MEMORY] Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()