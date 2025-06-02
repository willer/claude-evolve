#!/bin/bash
# CSV locking functions for parallel execution

# Lock file location
CSV_LOCKFILE="${EVOLUTION_DIR:-evolution}/.evolution.csv.lock"

# Acquire exclusive lock on CSV file
# Usage: acquire_csv_lock [timeout_seconds]
acquire_csv_lock() {
    local timeout="${1:-30}"
    local lockdir="$(dirname "$CSV_LOCKFILE")"
    
    # Ensure lock directory exists
    mkdir -p "$lockdir"
    
    # Try to acquire lock with timeout
    if command -v flock >/dev/null 2>&1; then
        # Use flock if available (Linux)
        exec 200>"$CSV_LOCKFILE"
        if ! flock -w "$timeout" -x 200; then
            echo "ERROR: Failed to acquire CSV lock within $timeout seconds" >&2
            return 1
        fi
    else
        # Fallback for systems without flock (macOS)
        local start_time=$(date +%s)
        while ! (set -C; echo $$ > "$CSV_LOCKFILE") 2>/dev/null; do
            local current_time=$(date +%s)
            if [ $((current_time - start_time)) -ge $timeout ]; then
                echo "ERROR: Failed to acquire CSV lock within $timeout seconds" >&2
                return 1
            fi
            sleep 0.1
        done
    fi
    return 0
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
    local csv_file="${EVOLUTION_DIR:-evolution}/evolution.csv"
    
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
    local csv_file="${EVOLUTION_DIR:-evolution}/evolution.csv"
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
    local csv_file="${EVOLUTION_DIR:-evolution}/evolution.csv"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Determine field position
    local field_pos
    case "$field" in
        "status") field_pos=5 ;;
        "performance") field_pos=4 ;;
        "description") field_pos=3 ;;
        "basedOnId") field_pos=2 ;;
        *) 
            echo "ERROR: Unknown field: $field" >&2
            release_csv_lock
            return 1
            ;;
    esac
    
    # Update CSV using awk
    awk -F',' -v OFS=',' -v id="$target_id" -v pos="$field_pos" -v val="$value" '
        NR==1 || $1 != id { print }
        $1 == id { $pos = val; print }
    ' "$csv_file" > "${csv_file}.tmp" && mv -f "${csv_file}.tmp" "$csv_file"
    
    release_csv_lock
    return 0
}

# Find next pending candidate with lock
# Usage: next_pending=$(find_next_pending_with_lock)
find_next_pending_with_lock() {
    local csv_file="${EVOLUTION_DIR:-evolution}/evolution.csv"
    
    if ! acquire_csv_lock; then
        return 1
    fi
    
    # Find oldest pending candidate and update to running
    local candidate=$(awk -F',' '
        NR>1 && ($5 == "pending" || $5 == "") { print $1; exit }
    ' "$csv_file")
    
    if [ -n "$candidate" ]; then
        # Update status to running while we have the lock
        awk -F',' -v OFS=',' -v id="$candidate" '
            NR==1 || $1 != id { print }
            $1 == id { 
                # Preserve existing fields but set status to running
                if ($5 == "" || $5 == "pending") $5 = "running"
                print 
            }
        ' "$csv_file" > "${csv_file}.tmp" && mv -f "${csv_file}.tmp" "$csv_file"
    fi
    
    release_csv_lock
    echo "$candidate"
}