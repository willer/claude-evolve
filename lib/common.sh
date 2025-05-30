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
