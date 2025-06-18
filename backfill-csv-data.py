#!/usr/bin/env python3
"""
Backfill CSV data by re-running evaluations for completed rows that have missing metrics.
"""

import sys
import csv
import json
import subprocess
from pathlib import Path

def read_csv_data(csv_file):
    """Read CSV and return headers and rows."""
    with open(csv_file, 'r') as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows = list(reader)
    return headers, rows

def run_evaluator(evolution_dir, candidate_id):
    """Run the evaluator for a specific candidate and return JSON result."""
    algorithm_file = Path(evolution_dir) / f"evolution_{candidate_id}.py"
    
    if not algorithm_file.exists():
        print(f"Algorithm file not found: {algorithm_file}", file=sys.stderr)
        return None
    
    try:
        # Run the evaluator
        cmd = [
            "python", 
            str(Path(evolution_dir) / "evaluate.py"), 
            str(algorithm_file)
        ]
        
        env = {"EXPERIMENT_ID": candidate_id}
        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
        
        if result.returncode != 0:
            print(f"Evaluator failed for {candidate_id}: {result.stderr}", file=sys.stderr)
            return None
        
        # Extract the last JSON line
        lines = result.stdout.strip().split('\n')
        for line in reversed(lines):
            line = line.strip()
            if line.startswith('{') and line.endswith('}'):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        
        print(f"No valid JSON found in evaluator output for {candidate_id}", file=sys.stderr)
        return None
        
    except Exception as e:
        print(f"Error running evaluator for {candidate_id}: {e}", file=sys.stderr)
        return None

def main():
    if len(sys.argv) != 3:
        print("Usage: backfill-csv-data.py <evolution_dir> <csv_file>")
        sys.exit(1)
    
    evolution_dir = sys.argv[1]
    csv_file = sys.argv[2]
    
    print(f"Reading CSV: {csv_file}")
    headers, rows = read_csv_data(csv_file)
    
    # Find indices for the metrics columns
    try:
        perf_idx = headers.index('performance')
        status_idx = headers.index('status')
        total_return_idx = headers.index('total_return')
    except ValueError:
        print("CSV must have performance, status, and total_return columns")
        sys.exit(1)
    
    updated_count = 0
    
    for i, row in enumerate(rows):
        candidate_id = row[0]  # First column is ID
        status = row[status_idx] if len(row) > status_idx else ""
        total_return = row[total_return_idx] if len(row) > total_return_idx else ""
        
        # Skip if not completed or already has data
        if status != "complete" or total_return:
            continue
        
        print(f"Backfilling data for {candidate_id}...")
        
        # Run the evaluator
        json_data = run_evaluator(evolution_dir, candidate_id)
        if not json_data:
            print(f"Failed to get data for {candidate_id}")
            continue
        
        # Update CSV using the csv_helper
        try:
            cmd = [
                "python3",
                "/Users/willer/Documents/GitHub/claude-evolve/lib/csv_helper.py",
                "update_with_json",
                csv_file,
                candidate_id,
                json.dumps(json_data)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                print(f"✓ Updated {candidate_id}")
                updated_count += 1
            else:
                print(f"✗ Failed to update {candidate_id}: {result.stderr}")
                
        except Exception as e:
            print(f"✗ Error updating {candidate_id}: {e}")
    
    print(f"\nBackfill complete! Updated {updated_count} rows.")

if __name__ == "__main__":
    main()