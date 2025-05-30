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
	if [[ "${DEBUG:-}" == "1" ]]; then
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

	if [[ ! -f "$file" ]]; then
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

	if [[ ! -f "$package_file" ]]; then
		log_error "package.json not found at: $package_file"
		exit 1
	fi

	parse_json "$package_file" ".version" | tr -d '"'
}

# Validate that a directory exists
ensure_directory() {
	local dir="$1"
	if [[ ! -d "$dir" ]]; then
		log_error "Directory does not exist: $dir"
		exit 1
	fi
}

# Create directory if it doesn't exist
create_directory() {
	local dir="$1"
	if [[ ! -d "$dir" ]]; then
		log_info "Creating directory: $dir"
		mkdir -p "$dir"
	fi
}

# Check if file exists and is readable
validate_file() {
	local file="$1"
	if [[ ! -f "$file" ]]; then
		log_error "File not found: $file"
		exit 1
	fi
	if [[ ! -r "$file" ]]; then
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
	if [[ -d "$path" ]]; then
		(cd "$path" && pwd)
	elif [[ -f "$path" ]]; then
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
	
	if [[ ! -f "$csv_file" ]]; then
		log_error "CSV file not found: $csv_file"
		exit 1
	fi
	
	# Skip header, find first row with empty status (column 5) or performance (column 4)
	# CSV format: id,basedOnId,description,performance,status
	local row_num
	row_num=$(awk -F, 'NR > 1 && ($4 == "" || $5 == "") { print NR; exit }' "$csv_file")
	
	if [[ -z "$row_num" ]]; then
		log_error "No empty rows found in CSV. Run 'claude-evolve ideate' to add candidates."
		exit 1
	fi
	
	echo "$row_num"
}

# Update a specific row in CSV with new values
update_csv_row() {
	local csv_file="$1"
	local row_num="$2"
	local performance="$3"
	local status="$4"
	
	if [[ ! -f "$csv_file" ]]; then
		log_error "CSV file not found: $csv_file"
		exit 1
	fi
	
	# Create lock file for atomic updates
	local lock_file="${csv_file}.lock"
	local temp_file="${csv_file}.tmp"
	
	# Wait for lock (simple file-based locking)
	local timeout=30
	local count=0
	while [[ -f "$lock_file" ]]; do
		if [[ $count -ge $timeout ]]; then
			log_error "Timeout waiting for CSV lock"
			exit 1
		fi
		sleep 1
		((count++))
	done
	
	# Create lock
	echo $$ > "$lock_file"
	
	# Update the specific row
	awk -F, -v OFS=',' -v row="$row_num" -v perf="$performance" -v stat="$status" '
		NR == row { $4 = perf; $5 = stat }
		{ print }
	' "$csv_file" > "$temp_file"
	
	# Atomic replace
	if mv "$temp_file" "$csv_file"; then
		rm -f "$lock_file"
		log_debug "Updated CSV row $row_num: performance=$performance, status=$status"
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
	
	if [[ ! -f "$csv_file" ]]; then
		log_error "CSV file not found: $csv_file"
		exit 1
	fi
	
	awk -F, -v row="$row_num" 'NR == row { print $1 "\t" $2 "\t" $3 "\t" $4 "\t" $5 }' "$csv_file"
}

# Generate next evolution ID
generate_evolution_id() {
	local csv_file="$1"
	
	if [[ ! -f "$csv_file" ]]; then
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
	echo "${new_id},,\"${escaped_desc}\",," >> "$csv_file"
	
	log_debug "Added idea ${new_id}: ${description}"
	echo "$new_id"
}

# Get top N performers from CSV for context
get_top_performers() {
	local csv_file="$1"
	local limit="${2:-5}"
	
	if [[ ! -f "$csv_file" ]]; then
		return
	fi
	
	# Sort by performance (column 4) descending, skip header, limit results
	# Only include rows with non-empty performance values
	awk -F, 'NR > 1 && $4 != "" { print }' "$csv_file" | \
		sort -t, -k4 -nr | \
		head -n "$limit"
}
