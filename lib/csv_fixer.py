#!/usr/bin/env python3
"""
CSV format fixer for claude-evolve
Ensures proper quoting of CSV fields, especially descriptions
Also filters out corrupted records with invalid ID formats
"""

import csv
import sys
import re

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

    # Reject IDs containing pipe characters (line number artifacts)
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
    Also filters out rows with invalid candidate IDs.
    """
    with open(input_file, 'r') as infile:
        reader = csv.reader(infile)
        rows = list(reader)

    rejected_count = 0
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

        # Check if candidate ID is valid
        if not is_valid_candidate_id(candidate_id):
            rejected_count += 1
            print(f"[WARN] Rejecting corrupted record with invalid ID: {candidate_id}", file=sys.stderr)
            continue

        filtered_rows.append(row)

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