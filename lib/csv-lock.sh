#!/bin/bash
# CSV locking functions for parallel execution

# Lock file location
CSV_LOCKFILE="${EVOLUTION_DIR:-evolution}/.evolution.csv.lock"

# Acquire exclusive lock on CSV file with automatic stale lock cleanup
# Usage: acquire_csv_lock [timeout_seconds]
acquire_csv_lock() {
    local timeout="${1:-${LOCK_TIMEOUT:-10}}"  # Reduced default timeout
    local lockdir="$(dirname "$CSV_LOCKFILE")"
    
    # Ensure lock directory exists
    mkdir -p "$lockdir"
    
    # AIDEV-NOTE: Robust locking with automatic stale lock detection and cleanup
    # CSV operations should be fast (<100ms), so long timeouts indicate problems
    
    # Clean up stale locks first
    cleanup_stale_locks
    
    # Try to acquire lock with short timeout and fast retry
    local end_time=$(($(date +%s) + timeout))
    local sleep_time=0.01  # Start with 10ms sleep
    
    while [ $(date +%s) -lt $end_time ]; do
        if command -v flock >/dev/null 2>&1; then
            # Use flock if available (Linux) - this should be instant
            exec 200>"$CSV_LOCKFILE"
            if flock -n -x 200; then
                return 0
            fi
        else
            # Fallback for systems without flock (macOS)
            if (set -C; echo $$ > "$CSV_LOCKFILE") 2>/dev/null; then
                return 0
            fi
            
            # Check if existing lock is stale and clean it up
            if [ -f "$CSV_LOCKFILE" ]; then
                local lock_pid=$(cat "$CSV_LOCKFILE" 2>/dev/null)
                if [[ "$lock_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
                    echo "[DEBUG] Removing stale lock from dead process $lock_pid" >&2
                    rm -f "$CSV_LOCKFILE"
                    continue  # Try again immediately
                fi
            fi
        fi
        
        # Brief sleep with exponential backoff (cap at 100ms)
        sleep "$sleep_time"
        sleep_time=$(echo "$sleep_time * 1.5" | bc -l 2>/dev/null | head -c 10)
        if (( $(echo "$sleep_time > 0.1" | bc -l 2>/dev/null || echo 0) )); then
            sleep_time=0.1
        fi
    done
    
    echo "ERROR: Failed to acquire CSV lock within $timeout seconds" >&2
    echo "ERROR: This indicates a serious problem - CSV operations should be fast" >&2
    
    # As a last resort, if lock is very old, break it
    if [ -f "$CSV_LOCKFILE" ]; then
        local lock_age=$(($(date +%s) - $(stat -f %m "$CSV_LOCKFILE" 2>/dev/null || stat -c %Y "$CSV_LOCKFILE" 2>/dev/null || echo $(date +%s))))
        if [ $lock_age -gt 60 ]; then  # Lock older than 1 minute is definitely stale
            echo "[WARN] Breaking very old lock file (${lock_age}s old)" >&2
            rm -f "$CSV_LOCKFILE"
            return 1  # Still return error to trigger retry
        fi
    fi
    
    return 1
}

# Clean up stale lock files
cleanup_stale_locks() {
    if [ ! -f "$CSV_LOCKFILE" ]; then
        return 0
    fi
    
    # Check file age - any lock older than 10 seconds is definitely stale
    local lock_age=$(($(date +%s) - $(stat -f %m "$CSV_LOCKFILE" 2>/dev/null || stat -c %Y "$CSV_LOCKFILE" 2>/dev/null || echo $(date +%s))))
    if [ $lock_age -gt 10 ]; then
        echo "[DEBUG] Removing stale lock file (${lock_age}s old)" >&2
        rm -f "$CSV_LOCKFILE"
        return 0
    fi
    
    # Check if process is still alive (macOS fallback mode only)
    if ! command -v flock >/dev/null 2>&1; then
        local lock_pid=$(cat "$CSV_LOCKFILE" 2>/dev/null)
        if [[ "$lock_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
            echo "[DEBUG] Removing lock from dead process $lock_pid" >&2
            rm -f "$CSV_LOCKFILE"
        fi
    fi
}

# Release CSV lock
release_csv_lock() {
    if command -v flock >/dev/null 2>&1; then
        # Release flock
        exec 200>&-
    else
        # Remove lock file
        rm -f "$CSV_LOCKFILE"
    fi
}

# Read CSV with lock
# Usage: read_csv_with_lock <variable_name>
read_csv_with_lock() {
    local var_name="$1"
    
    # Ensure we have the full CSV path set
    if [[ -z "$FULL_CSV_PATH" ]]; then
        echo "[ERROR] FULL_CSV_PATH not set in read_csv_with_lock" >&2
        return 1
    fi
    local csv_file="$FULL_CSV_PATH"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Read CSV content
    if [ -f "$csv_file" ]; then
        eval "$var_name=\$(cat '$csv_file')"
    else
        eval "$var_name=''"
    fi
    
    release_csv_lock
    return 0
}

# Write CSV with lock
# Usage: echo "content" | write_csv_with_lock
write_csv_with_lock() {
    # Ensure we have the full CSV path set
    if [[ -z "$FULL_CSV_PATH" ]]; then
        echo "[ERROR] FULL_CSV_PATH not set in write_csv_with_lock" >&2
        return 1
    fi
    local csv_file="$FULL_CSV_PATH"
    local temp_file="${csv_file}.tmp.$$"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Write to temporary file first
    cat > "$temp_file"
    
    # Atomic move
    mv -f "$temp_file" "$csv_file"
    
    release_csv_lock
    return 0
}

# Update single CSV row with lock
# Usage: update_csv_row_with_lock <id> <field> <value>
update_csv_row_with_lock() {
    local target_id="$1"
    local field="$2"
    local value="$3"
    
    # Ensure we have the full CSV path set
    if [[ -z "$FULL_CSV_PATH" ]]; then
        echo "[ERROR] FULL_CSV_PATH not set in update_csv_row_with_lock" >&2
        return 1
    fi
    local csv_file="$FULL_CSV_PATH"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Determine field position (0-based for Python)
    local field_pos
    case "$field" in
        "status") field_pos=4 ;;
        "performance") field_pos=3 ;;
        "description") field_pos=2 ;;
        "basedOnId") field_pos=1 ;;
        *) 
            echo "ERROR: Unknown field: $field" >&2
            release_csv_lock
            return 1
            ;;
    esac
    
    # Update CSV using Python
    "$PYTHON_CMD" -c "
import csv
import sys

# Read CSV
with open('$csv_file', 'r') as f:
    reader = csv.reader(f)
    rows = list(reader)

# Update the specific field
for i in range(1, len(rows)):
    if rows[i][0] == '$target_id':
        rows[i][$field_pos] = '$value'
        break

# Write back
with open('${csv_file}.tmp', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(rows)
" && mv -f "${csv_file}.tmp" "$csv_file"
    
    release_csv_lock
    return 0
}

# Find next pending candidate with lock
# Usage: next_pending=$(find_next_pending_with_lock)
find_next_pending_with_lock() {
    # Ensure we have the full CSV path set
    if [[ -z "$FULL_CSV_PATH" ]]; then
        echo "[ERROR] FULL_CSV_PATH not set in find_next_pending_with_lock" >&2
        return 1
    fi
    local csv_file="$FULL_CSV_PATH"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Find oldest pending candidate and update to running using Python
    local candidate=$("$PYTHON_CMD" -c "
import csv
import sys

# Read CSV
with open('$csv_file', 'r') as f:
    reader = csv.reader(f)
    rows = list(reader)

# Find first pending candidate
candidate_id = None
for i in range(1, len(rows)):
    # If row has fewer than 5 fields, it's pending
    if len(rows[i]) < 5:
        candidate_id = rows[i][0]
        # Ensure row has 5 fields before setting status
        while len(rows[i]) < 5:
            rows[i].append('')
        rows[i][4] = 'running'  # Update status
        break
    elif len(rows[i]) >= 5 and (rows[i][4] == 'pending' or rows[i][4] == ''):
        candidate_id = rows[i][0]
        rows[i][4] = 'running'  # Update status
        break

# Write back if we found a candidate
if candidate_id:
    with open('${csv_file}.tmp', 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)
    print(candidate_id)
")
    
    if [ -n "$candidate" ]; then
        mv -f "${csv_file}.tmp" "$csv_file"
    fi
    
    release_csv_lock
    echo "$candidate"
}