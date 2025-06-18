#!/usr/bin/env python3
"""
CSV helper for dynamic column management in claude-evolve.
Handles adding new columns and updating rows with arbitrary fields.
"""

import csv
import json
import sys
import os
from typing import Dict, List, Any


def read_csv(filepath: str) -> tuple[list[str], list[list[str]]]:
    """Read CSV and return headers and rows."""
    with open(filepath, 'r') as f:
        reader = csv.reader(f)
        headers = next(reader, [])
        rows = list(reader)
    return headers, rows


def write_csv(filepath: str, headers: list[str], rows: list[list[str]]):
    """Write CSV with headers and rows."""
    with open(filepath, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def ensure_columns(headers: list[str], rows: list[list[str]], new_fields: dict) -> tuple[list[str], list[list[str]]]:
    """Add new columns if they don't exist and ensure all rows have correct length."""
    # Find which fields need to be added as new columns
    existing_columns = set(headers)
    new_columns = []
    
    for field in new_fields:
        if field not in existing_columns and field not in ['id', 'basedOnId', 'description', 'performance', 'status']:
            new_columns.append(field)
    
    # Add new columns to headers (after status column)
    if new_columns:
        headers = headers + new_columns
    
    # Ensure all rows have the correct number of columns
    for row in rows:
        while len(row) < len(headers):
            row.append('')
    
    return headers, rows


def update_row_with_fields(headers: list[str], rows: list[list[str]], target_id: str, fields: dict):
    """Update a specific row with multiple fields."""
    # Find column indices
    col_indices = {header: i for i, header in enumerate(headers)}
    
    # Find and update the target row
    for row in rows:
        if row[0] == target_id:
            for field, value in fields.items():
                if field in col_indices:
                    print(f"[DEBUG] Updating field '{field}' with value: {repr(value)}", file=sys.stderr)
                    row[col_indices[field]] = str(value)
            break


def main():
    """Main entry point for CSV operations."""
    if len(sys.argv) < 3:
        print("Usage: csv_helper.py <operation> <args...>", file=sys.stderr)
        sys.exit(1)
    
    operation = sys.argv[1]
    
    if operation == "update_with_json":
        # Args: csv_file, target_id, json_output
        if len(sys.argv) != 5:
            print("Usage: csv_helper.py update_with_json <csv_file> <target_id> <json_output>", file=sys.stderr)
            sys.exit(1)
        
        csv_file = sys.argv[2]
        target_id = sys.argv[3]
        json_output = sys.argv[4]
        
        try:
            # Parse JSON output
            data = json.loads(json_output)
            
            # Extract performance/score
            performance = data.get('performance') or data.get('score', 0)
            
            # Build fields to update
            fields = {'performance': performance, 'status': 'complete' if performance > 0 else 'failed'}
            
            # Add all other fields from the JSON
            for key, value in data.items():
                if key not in ['performance', 'score', 'status']:
                    fields[key] = value
            
            # Read CSV
            headers, rows = read_csv(csv_file)
            
            # Ensure columns exist for all fields
            headers, rows = ensure_columns(headers, rows, fields)
            
            # Update the row
            update_row_with_fields(headers, rows, target_id, fields)
            
            # Write back
            write_csv(csv_file + '.tmp', headers, rows)
            os.rename(csv_file + '.tmp', csv_file)
            
            # Return the performance score
            print(performance)
            
        except json.JSONDecodeError:
            print("0")  # Invalid JSON means failed
            sys.exit(1)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            print("0")
            sys.exit(1)
    
    elif operation == "update_field":
        # Args: csv_file, target_id, field, value
        if len(sys.argv) != 6:
            print("Usage: csv_helper.py update_field <csv_file> <target_id> <field> <value>", file=sys.stderr)
            sys.exit(1)
        
        csv_file = sys.argv[2]
        target_id = sys.argv[3]
        field = sys.argv[4]
        value = sys.argv[5]
        
        try:
            # Read CSV
            headers, rows = read_csv(csv_file)
            
            # Ensure column exists
            headers, rows = ensure_columns(headers, rows, {field: value})
            
            # Update the row
            update_row_with_fields(headers, rows, target_id, {field: value})
            
            # Write back
            write_csv(csv_file + '.tmp', headers, rows)
            os.rename(csv_file + '.tmp', csv_file)
            
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    
    elif operation == "find_pending":
        # Args: csv_file
        if len(sys.argv) != 3:
            print("Usage: csv_helper.py find_pending <csv_file>", file=sys.stderr)
            sys.exit(1)
        
        csv_file = sys.argv[2]
        
        try:
            headers, rows = read_csv(csv_file)
            
            # Find first row with empty status or status == "pending"
            for i, row in enumerate(rows, start=2):  # Start at 2 (1-indexed, skip header)
                if len(row) < 5 or row[4] == '' or row[4] == 'pending':
                    print(i)
                    sys.exit(0)
            
            # No pending found
            sys.exit(1)
            
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    
    elif operation == "get_row":
        # Args: csv_file, row_num
        if len(sys.argv) != 4:
            print("Usage: csv_helper.py get_row <csv_file> <row_num>", file=sys.stderr)
            sys.exit(1)
        
        csv_file = sys.argv[2]
        row_num = int(sys.argv[3])
        
        try:
            headers, rows = read_csv(csv_file)
            
            # Get the specific row (row_num is 1-indexed, includes header)
            if row_num < 2 or row_num > len(rows) + 1:
                print(f"Row {row_num} out of range", file=sys.stderr)
                sys.exit(1)
            
            row = rows[row_num - 2]  # Convert to 0-indexed, skip header
            
            # Output shell variable assignments
            print(f'id="{row[0] if len(row) > 0 else ""}"')
            print(f'based_on_id="{row[1] if len(row) > 1 else ""}"')
            print(f'description="{row[2] if len(row) > 2 else ""}"')
            print(f'performance="{row[3] if len(row) > 3 else ""}"')
            print(f'status="{row[4] if len(row) > 4 else ""}"')
            
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    
    elif operation == "update_row":
        # Args: csv_file, row_num, performance, status
        if len(sys.argv) != 6:
            print("Usage: csv_helper.py update_row <csv_file> <row_num> <performance> <status>", file=sys.stderr)
            sys.exit(1)
        
        csv_file = sys.argv[2]
        row_num = int(sys.argv[3])
        performance = sys.argv[4]
        status = sys.argv[5]
        
        try:
            headers, rows = read_csv(csv_file)
            
            # Update the specific row
            if row_num < 2 or row_num > len(rows) + 1:
                print(f"Row {row_num} out of range", file=sys.stderr)
                sys.exit(1)
            
            row_idx = row_num - 2  # Convert to 0-indexed, skip header
            
            # Ensure row has enough columns
            while len(rows[row_idx]) < 5:
                rows[row_idx].append('')
            
            # Update performance and status
            rows[row_idx][3] = performance
            rows[row_idx][4] = status
            
            # Write back
            write_csv(csv_file + '.tmp', headers, rows)
            os.rename(csv_file + '.tmp', csv_file)
            
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    
    else:
        print(f"Unknown operation: {operation}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()