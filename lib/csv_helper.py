#!/usr/bin/env python3
"""
CSV helper for claude-evolve to properly handle CSV parsing with quoted fields.
"""
import csv
import sys
import json

def find_pending_row(csv_path):
    """Find the first pending row in the CSV."""
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # Skip header
        for row_num, row in enumerate(reader, start=2):
            # If row has fewer than 5 fields, it's pending
            if len(row) < 5:
                return row_num
            
            # Ensure row has at least 5 fields for status check
            while len(row) < 5:
                row.append('')
            
            status = row[4].strip()
            # Check if status is pending or empty
            if status == 'pending' or status == '':
                return row_num
    return None

def get_row_data(csv_path, row_num):
    """Get data from a specific row."""
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader, start=1):
            if i == row_num:
                # Ensure row has at least 5 fields
                while len(row) < 5:
                    row.append('')
                return {
                    'id': row[0],
                    'basedOnId': row[1],
                    'description': row[2],
                    'performance': row[3],
                    'status': row[4]
                }
    return None

def update_row(csv_path, row_num, performance, status):
    """Update a specific row in the CSV."""
    rows = []
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        rows = list(reader)
    
    # Update the specific row
    if row_num <= len(rows):
        row = rows[row_num - 1]
        # Ensure row has at least 5 fields
        while len(row) < 5:
            row.append('')
        row[3] = performance  # performance field
        row[4] = status       # status field
    
    # Write back
    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: csv_helper.py <command> <csv_path> [args...]", file=sys.stderr)
        sys.exit(1)
    
    command = sys.argv[1]
    csv_path = sys.argv[2]
    
    try:
        if command == 'find_pending':
            row_num = find_pending_row(csv_path)
            if row_num:
                print(row_num)
                sys.exit(0)
            else:
                sys.exit(1)
        
        elif command == 'get_row':
            if len(sys.argv) < 4:
                print("Usage: csv_helper.py get_row <csv_path> <row_num>", file=sys.stderr)
                sys.exit(1)
            row_num = int(sys.argv[3])
            data = get_row_data(csv_path, row_num)
            if data:
                # Output as shell variable assignments
                for key, value in data.items():
                    # Escape special characters for shell
                    value = value.replace('\\', '\\\\')
                    value = value.replace('"', '\\"')
                    value = value.replace('$', '\\$')
                    value = value.replace('`', '\\`')
                    print(f'{key}="{value}"')
                sys.exit(0)
            else:
                sys.exit(1)
        
        elif command == 'update_row':
            if len(sys.argv) < 6:
                print("Usage: csv_helper.py update_row <csv_path> <row_num> <performance> <status>", file=sys.stderr)
                sys.exit(1)
            row_num = int(sys.argv[3])
            performance = sys.argv[4]
            status = sys.argv[5]
            update_row(csv_path, row_num, performance, status)
            sys.exit(0)
        
        else:
            print(f"Unknown command: {command}", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)