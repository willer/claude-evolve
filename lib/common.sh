#!/bin/bash

# Common utility functions for claude-evolve

set -euo pipefail

# Logging functions
log_info() {
  echo "[INFO] $*" >&2
}

log_warn() {
  echo "[WARN] $*" >&2
}

log_warning() {
  echo "[WARN] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

log_debug() {
  if [[ ${DEBUG:-} == "1" ]]; then
    echo "[DEBUG] $*" >&2
  fi
}

# Check if required command exists
require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Required command '$cmd' not found. Please install it first."
    exit 1
  fi
}

# Parse JSON using jq with error handling
parse_json() {
  local file="$1"
  local query="$2"

  if [[ ! -f $file ]]; then
    log_error "File not found: $file"
    exit 1
  fi

  require_command "jq"

  if ! jq -e "$query" "$file" 2>/dev/null; then
    log_error "Failed to parse JSON from $file with query: $query"
    exit 1
  fi
}

# Get version from package.json
get_package_version() {
  local package_file="${1:-package.json}"

  if [[ ! -f $package_file ]]; then
    log_error "package.json not found at: $package_file"
    exit 1
  fi

  parse_json "$package_file" ".version" | tr -d '"'
}

# Validate that a directory exists
ensure_directory() {
  local dir="$1"
  if [[ ! -d $dir ]]; then
    log_error "Directory does not exist: $dir"
    exit 1
  fi
}

# Create directory if it doesn't exist
create_directory() {
  local dir="$1"
  if [[ ! -d $dir ]]; then
    log_info "Creating directory: $dir"
    mkdir -p "$dir"
  fi
}

# Check if file exists and is readable
validate_file() {
  local file="$1"
  if [[ ! -f $file ]]; then
    log_error "File not found: $file"
    exit 1
  fi
  if [[ ! -r $file ]]; then
    log_error "File not readable: $file"
    exit 1
  fi
}

# Safe file copy with validation
safe_copy() {
  local src="$1"
  local dest="$2"

  validate_file "$src"

  local dest_dir
  dest_dir="$(dirname "$dest")"
  create_directory "$dest_dir"

  if cp "$src" "$dest"; then
    log_info "Copied $src to $dest"
  else
    log_error "Failed to copy $src to $dest"
    exit 1
  fi
}

# Get absolute path
get_abs_path() {
  local path="$1"
  if [[ -d $path ]]; then
    (cd "$path" && pwd)
  elif [[ -f $path ]]; then
    local dir
    dir="$(dirname "$path")"
    local file
    file="$(basename "$path")"
    echo "$(cd "$dir" && pwd)/$file"
  else
    log_error "Path does not exist: $path"
    exit 1
  fi
}

# CSV manipulation functions for evolution tracking

# Find the oldest row in CSV with empty status or performance
find_oldest_empty_row() {
  local csv_file="$1"

  if [[ ! -f $csv_file ]]; then
    echo "CSV file not found: $csv_file" >&2
    return 1
  fi

  # Skip header, find first row with empty status (column 5) and empty performance (column 4)
  # CSV format: id,basedOnId,description,performance,status
  local row_num
  row_num=$(python3 -c "
import csv
import sys
with open('$csv_file', 'r') as f:
    reader = csv.reader(f)
    rows = list(reader)
    for i, row in enumerate(rows[1:], start=2):  # Skip header, start at row 2
        if len(row) >= 5:
            performance = row[3].strip()
            status = row[4].strip()
            if performance == '' and status == '':
                print(i)
                sys.exit(0)
sys.exit(1)
" 2>/dev/null)

  if [[ -z $row_num ]]; then
    echo "No empty rows found in CSV. Run 'claude-evolve ideate' to add candidates." >&2
    return 1
  fi

  echo "$row_num"
}

# Update a specific row in CSV with new values
update_csv_row() {
  local csv_file="$1"
  local row_num="$2"
  local performance="$3"
  local row_status="$4"

  if [[ ! -f $csv_file ]]; then
    log_error "CSV file not found: $csv_file"
    exit 1
  fi

  # Create lock file for atomic updates
  local lock_file="${csv_file}.lock"
  local temp_file="${csv_file}.tmp"

  # Wait for lock (simple file-based locking)
  local timeout=30
  local count=0
  while [[ -f $lock_file ]]; do
    if [[ $count -ge $timeout ]]; then
      log_error "Timeout waiting for CSV lock"
      exit 1
    fi
    sleep 1
    ((count++))
  done

  # Create lock
  echo $$ >"$lock_file"

  # Update the specific row using Python for proper CSV handling
  python3 -c "
import csv
import sys

# Read the CSV file
with open('$csv_file', 'r') as f:
    reader = csv.reader(f)
    rows = list(reader)

# Update the specified row (1-indexed)
row_idx = $row_num - 1
if 0 <= row_idx < len(rows) and len(rows[row_idx]) >= 5:
    rows[row_idx][3] = '$performance'  # performance column
    rows[row_idx][4] = '$row_status'       # status column
else:
    sys.exit(1)

# Write the updated CSV
with open('$temp_file', 'w', newline='') as f:
    writer = csv.writer(f, lineterminator='\n')
    writer.writerows(rows)
"

  # Atomic replace
  if mv "$temp_file" "$csv_file"; then
    rm -f "$lock_file"
    log_debug "Updated CSV row $row_num: performance=$performance, status=$row_status"
  else
    rm -f "$lock_file" "$temp_file"
    log_error "Failed to update CSV file"
    exit 1
  fi
}

# Get CSV row data as tab-separated values
get_csv_row() {
  local csv_file="$1"
  local row_num="$2"

  if [[ ! -f $csv_file ]]; then
    echo "CSV file not found: $csv_file" >&2
    return 1
  fi

  # Get the raw line and convert to tab-separated, handling quoted fields
  local line
  line=$(sed -n "${row_num}p" "$csv_file")
  if [[ -z $line ]]; then
    return 1
  fi

  # Use python with proper escaping to parse CSV while preserving quotes
  printf '%s\n' "$line" | python3 -c "
import sys
line = sys.stdin.read().strip()
# Simple CSV parser that preserves quotes in description field
fields = []
current_field = ''
in_quotes = False

for char in line:
    if char == '\"':
        in_quotes = not in_quotes
        current_field += char
    elif char == ',' and not in_quotes:
        fields.append(current_field)
        current_field = ''
    else:
        current_field += char

# Don't forget the last field
fields.append(current_field)

# Debug output
# sys.stderr.write(f'Debug: line={repr(line)}\n')
# sys.stderr.write(f'Debug: fields={fields}\n')

# Ensure we have exactly 5 fields
while len(fields) < 5:
    fields.append('')

print('\t'.join(fields[:5]))
"
}

# Generate next evolution ID
generate_evolution_id() {
  local csv_file="$1"

  if [[ ! -f $csv_file ]]; then
    echo "1"
    return
  fi

  # Find highest existing ID and increment
  local max_id
  max_id=$(awk -F, 'NR > 1 && $1 ~ /^[0-9]+$/ { if ($1 > max) max = $1 } END { print max + 0 }' "$csv_file")
  echo $((max_id + 1))
}

# Add a new idea to the evolution CSV
add_idea_to_csv() {
  local csv_file="$1"
  local description="$2"

  # Generate new ID
  local new_id
  new_id=$(generate_evolution_id "$csv_file")

  # Escape description for CSV (replace quotes with double quotes)
  local escaped_desc
  escaped_desc="${description//\"/\"\"}"

  # Append to CSV: id,basedOnId,description,performance,status
  echo "${new_id},,\"${escaped_desc}\",," >>"$csv_file"

  log_debug "Added idea ${new_id}: ${description}"
  echo "$new_id"
}

# Get top N performers from CSV for context
get_top_performers() {
  local csv_file="$1"
  local limit="${2:-5}"

  if [[ ! -f $csv_file ]]; then
    return
  fi

  # Sort by performance (column 4) descending, skip header, limit results
  # Only include rows with non-empty performance values
  awk -F, 'NR > 1 && $4 != "" { print }' "$csv_file" |
    sort -t, -k4 -nr |
    head -n "$limit"
}
