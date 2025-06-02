# Parallel Evolution Execution Design

## Overview
Enable optional parallel execution of evolution runs with a configurable number of worker processes.

## Architecture

### 1. Dispatcher Process (`claude-evolve-run` in parallel mode)
- Manages a pool of N worker processes
- Monitors CSV for pending candidates
- Assigns work to available workers
- Handles worker lifecycle (spawn, monitor, cleanup)
- Uses process IDs to track active workers

### 2. Worker Process (`claude-evolve-worker`)
- Executes a single evolution candidate
- Updates CSV with status changes
- Handles all the current logic from `claude-evolve-run`
- Exits after completing one candidate

### 3. CSV Synchronization
- Use file locking (flock) for CSV updates
- Workers acquire exclusive lock before reading/writing
- Short lock duration - only during CSV operations
- Status updates: pending → running → complete/failed

### 4. Configuration
```yaml
parallel:
  enabled: false  # Default to sequential mode
  max_workers: 4  # Maximum concurrent workers
  lock_timeout: 30  # Seconds to wait for CSV lock
```

### 5. Implementation Flow

```
Dispatcher:
1. Check if parallel mode enabled
2. Read CSV to count pending candidates
3. While pending > 0 and workers < max_workers:
   - Fork worker process
   - Track worker PID
4. Monitor worker processes:
   - When worker exits, check for more work
   - Handle crashed workers (cleanup status)
5. Exit when no pending and no active workers

Worker:
1. Acquire CSV lock
2. Find oldest pending candidate
3. Update status to "running"
4. Release CSV lock
5. Execute evolution (current claude-evolve-run logic)
6. Acquire CSV lock
7. Update status and performance
8. Release CSV lock
9. Exit
```

### 6. Benefits
- Faster evolution cycles with multiple candidates in parallel
- Better resource utilization
- Maintains backward compatibility (default off)
- Simple architecture with minimal changes

### 7. Considerations
- Claude API rate limits still apply
- File system must support flock
- Workers should log to separate files to avoid conflicts
- Parent should handle SIGCHLD to reap zombie processes