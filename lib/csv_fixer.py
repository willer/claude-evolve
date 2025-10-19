#!/usr/bin/env python3
"""
CSV format fixer for claude-evolve
Ensures proper quoting of CSV fields, especially descriptions
Also filters out corrupted records with invalid ID formats
"""

import csv
import sys
import re

def clean_candidate_id(candidate_id):
    """
    Clean and normalize a candidate ID.
    Returns (cleaned_id, was_modified)
    """
    if not candidate_id or candidate_id == "id":
        return candidate_id, False

    original = candidate_id
    cleaned = candidate_id

    # Strip leading/trailing whitespace
    cleaned = cleaned.strip()

    # Remove any internal spaces (e.g., "gen01 -001" -> "gen01-001")
    cleaned = re.sub(r'\s+', '', cleaned)

    # Remove pipe characters and anything before them (line number artifacts)
    if '|' in cleaned:
        # Extract the part after the last pipe
        parts = cleaned.split('|')
        cleaned = parts[-1].strip()

    return cleaned, (cleaned != original)

def is_valid_candidate_id(candidate_id):
    """
    Check if a candidate ID is valid.
    Valid formats:
    - baseline-000
    - gen00-000
    - gen01-001, gen02-042, etc.

    Invalid formats (to reject):
    - 00648| gen43-001 (line numbers with pipes)
    - Any ID containing | character
    - Any ID with leading numbers followed by |
    """
    if not candidate_id or candidate_id == "id":
        return True  # Header row

    # Reject IDs still containing pipe characters after cleaning
    if '|' in candidate_id:
        return False

    # Valid ID should match: baseline-NNN or genNN-NNN format
    # Also accept special IDs like "000", "0", etc.
    if re.match(r'^(baseline|gen\d{2})-\d{3}$', candidate_id):
        return True
    if re.match(r'^(000|0|gen00-000)$', candidate_id):
        return True

    # Reject anything with leading digits followed by non-standard format
    if re.match(r'^\d+\s', candidate_id):
        return False

    return True

def fix_csv_format(input_file, output_file):
    """
    Read a CSV file and ensure all fields are properly quoted.
    The csv module handles quoting automatically based on content.
    Also cleans and validates candidate IDs, filtering out invalid rows.
    """
    with open(input_file, 'r') as infile:
        reader = csv.reader(infile)
        rows = list(reader)

    rejected_count = 0
    cleaned_count = 0
    filtered_rows = []

    for i, row in enumerate(rows):
        # Always keep header
        if i == 0:
            filtered_rows.append(row)
            continue

        # Skip empty rows
        if not row or len(row) == 0:
            continue

        candidate_id = row[0] if len(row) > 0 else ""

        # Clean the candidate ID
        cleaned_id, was_modified = clean_candidate_id(candidate_id)

        if was_modified:
            cleaned_count += 1
            print(f"[INFO] Cleaned ID: '{candidate_id}' -> '{cleaned_id}'", file=sys.stderr)
            row[0] = cleaned_id

        # Check if candidate ID is valid after cleaning
        if not is_valid_candidate_id(cleaned_id):
            rejected_count += 1
            print(f"[WARN] Rejecting corrupted record with invalid ID: {candidate_id} (cleaned: {cleaned_id})", file=sys.stderr)
            continue

        # Trim whitespace from all other fields
        row = [field.strip() if isinstance(field, str) else field for field in row]

        filtered_rows.append(row)

    if cleaned_count > 0:
        print(f"[INFO] Cleaned {cleaned_count} IDs (removed spaces, pipes, etc.)", file=sys.stderr)
    if rejected_count > 0:
        print(f"[INFO] Filtered out {rejected_count} corrupted records", file=sys.stderr)

    with open(output_file, 'w', newline='') as outfile:
        writer = csv.writer(outfile, quoting=csv.QUOTE_NONNUMERIC)

        # Write all rows - csv.writer handles quoting automatically
        for row in filtered_rows:
            writer.writerow(row)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: csv_fixer.py <input_file> <output_file>", file=sys.stderr)
        sys.exit(1)
    
    try:
        fix_csv_format(sys.argv[1], sys.argv[2])
    except Exception as e:
        print(f"Error fixing CSV: {e}", file=sys.stderr)
        sys.exit(1)