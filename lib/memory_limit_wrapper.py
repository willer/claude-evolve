#!/usr/bin/env python3
"""
Memory-limited execution wrapper for claude-evolve evaluations.

This script runs a command with memory limits to prevent runaway algorithms
from consuming all system memory and crashing the machine.
"""
import sys
import os
import subprocess
import signal
import time
import resource
from typing import Optional

def set_memory_limit(limit_mb: int) -> None:
    """Set memory limit in MB using resource module."""
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
            
        print(f"[MEMORY] Set memory limit to {limit_mb}MB", file=sys.stderr)
        
    except (OSError, ValueError) as e:
        print(f"[MEMORY] Warning: Could not set memory limit: {e}", file=sys.stderr)

def monitor_memory_usage_native(process: subprocess.Popen, limit_mb: int) -> Optional[str]:
    """Monitor process memory usage using native tools and kill if it exceeds limits."""
    # print(f"[MEMORY] Starting native monitoring for PID {process.pid} with limit {limit_mb}MB", file=sys.stderr)
    
    while process.poll() is None:
        try:
            # Use ps command to get memory usage
            ps_result = subprocess.run(
                ["ps", "-o", "rss=", "-p", str(process.pid)], 
                capture_output=True, 
                text=True, 
                timeout=1
            )
            
            if ps_result.returncode == 0 and ps_result.stdout.strip():
                # ps returns RSS in KB, convert to MB
                memory_kb = int(ps_result.stdout.strip())
                memory_mb = memory_kb / 1024
                
                # print(f"[MEMORY] PID {process.pid} using {memory_mb:.1f}MB (limit: {limit_mb}MB)", file=sys.stderr)
                
                if memory_mb > limit_mb:
                    print(f"[MEMORY] Process exceeded {limit_mb}MB limit (using {memory_mb:.1f}MB), terminating", file=sys.stderr)
                    # Kill the entire process group - fix race condition
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
            
            time.sleep(0.5)  # Check every 500ms
            
        except (subprocess.TimeoutExpired, ValueError, ProcessLookupError):
            # Process might have terminated or ps command failed
            time.sleep(0.5)
            continue
    
    # print(f"[MEMORY] Monitoring stopped for PID {process.pid}", file=sys.stderr)
    return None

def monitor_memory_usage(process: subprocess.Popen, limit_mb: int) -> Optional[str]:
    """Monitor process memory usage and kill if it exceeds limits."""
    try:
        import psutil
        ps_process = psutil.Process(process.pid)
        
        while process.poll() is None:
            try:
                # Get memory usage in MB
                memory_info = ps_process.memory_info()
                memory_mb = memory_info.rss / (1024 * 1024)
                
                if memory_mb > limit_mb:
                    print(f"[MEMORY] Process exceeded {limit_mb}MB limit (using {memory_mb:.1f}MB), terminating", file=sys.stderr)
                    # Kill the entire process group - fix race condition
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
                
                time.sleep(0.5)  # Check every 500ms
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