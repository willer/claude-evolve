#!/usr/bin/env python3
"""Robust CSV helper for evolution system that handles edge cases properly."""

import csv
import sys


def is_valid_candidate_row(row):
    """Check if a row represents a valid candidate (not empty, has ID)."""
    if not row:
        return False
    if len(row) == 0:
        return False
    # First column should have a non-empty ID
    if not row[0] or row[0].strip() == '':
        return False
    return True


def is_pending_candidate(row):
    """Check if a candidate row is pending (needs processing)."""
    if not is_valid_candidate_row(row):
        return False
    
    # Must have at least 5 columns to check status
    if len(row) < 5:
        return True  # Incomplete row is pending
    
    # Check status field (5th column, index 4)
    status = row[4].strip().lower() if row[4] else ''
    
    # Blank, missing, "pending", or "running" all mean pending
    if not status or status in ['pending', 'running']:
        return True
    
    # Check for retry statuses
    if status.startswith('failed-retry'):
        return True
    
    return False


def get_pending_candidates(csv_file):
    """Get list of pending candidate IDs from CSV."""
    pending = []
    
    try:
        with open(csv_file, 'r') as f:
            reader = csv.reader(f)
            # Skip header
            next(reader, None)
            
            for row in reader:
                if is_pending_candidate(row):
                    candidate_id = row[0].strip()
                    status = row[4].strip() if len(row) > 4 else ''
                    pending.append((candidate_id, status))
    
    except Exception as e:
        print(f"Error reading CSV: {e}", file=sys.stderr)
        return []
    
    return pending


def update_candidate_status(csv_file, candidate_id, new_status):
    """Update the status of a specific candidate."""
    rows = []
    updated = False
    
    try:
        # Read all rows
        with open(csv_file, 'r') as f:
            reader = csv.reader(f)
            rows = list(reader)
        
        # Update the specific candidate
        for i, row in enumerate(rows):
            if is_valid_candidate_row(row) and row[0].strip() == candidate_id:
                # Ensure row has at least 5 columns
                while len(row) < 5:
                    row.append('')
                row[4] = new_status
                updated = True
                break
        
        # Write back if updated
        if updated:
            with open(csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(rows)
        
        return updated
    
    except Exception as e:
        print(f"Error updating CSV: {e}", file=sys.stderr)
        return False


if __name__ == '__main__':
    # Test functionality
    if len(sys.argv) < 2:
        print("Usage: csv_helper_robust.py <csv_file> [command]")
        sys.exit(1)
    
    csv_file = sys.argv[1]
    command = sys.argv[2] if len(sys.argv) > 2 else 'list'
    
    if command == 'list':
        pending = get_pending_candidates(csv_file)
        for candidate_id, status in pending:
            print(f"{candidate_id}|{status}")
    
    elif command == 'update' and len(sys.argv) >= 5:
        candidate_id = sys.argv[3]
        new_status = sys.argv[4]
        if update_candidate_status(csv_file, candidate_id, new_status):
            print(f"Updated {candidate_id} to {new_status}")
        else:
            print(f"Failed to update {candidate_id}")
            sys.exit(1)