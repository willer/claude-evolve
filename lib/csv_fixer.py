#!/usr/bin/env python3
"""
CSV format fixer for claude-evolve
Ensures proper quoting of CSV fields, especially descriptions
"""

import csv
import sys

def fix_csv_format(input_file, output_file):
    """
    Read a CSV file and ensure all fields are properly quoted.
    The csv module handles quoting automatically based on content.
    """
    with open(input_file, 'r') as infile:
        reader = csv.reader(infile)
        rows = list(reader)
    
    with open(output_file, 'w', newline='') as outfile:
        writer = csv.writer(outfile, quoting=csv.QUOTE_NONNUMERIC)
        
        # Write all rows - csv.writer handles quoting automatically
        for row in rows:
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