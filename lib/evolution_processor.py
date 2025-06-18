#!/usr/bin/env python3
"""
Evolution processor - common logic for processing evolution candidates.
Used by both sequential (claude-evolve-run) and parallel (claude-evolve-worker) modes.
"""

import os
import sys
import subprocess
import re
from pathlib import Path

def should_skip_processing(id_val, based_on_id, parent_file, output_file):
    """
    Determine if evolution processing should be skipped.
    
    Returns tuple: (skip_copy, skip_claude, reason)
    """
    # Baseline algorithm check
    if id_val in ["000", "0", "gen00-000"]:
        return True, True, "Baseline algorithm - no processing needed"
    
    # Self-parent detection (parent=child scenario)
    if parent_file == output_file:
        return True, True, "Self-parent detected - preserving existing code"
    
    # File existence check
    file_exists = os.path.exists(output_file)
    if file_exists and based_on_id == id_val:
        return True, True, "File exists and self-referential - no changes needed"
    
    return file_exists, False, None

def get_parent_file_path(based_on_id, output_dir, root_dir):
    """Get the parent file path based on based_on_id."""
    if not based_on_id or based_on_id in ["0", '""']:
        # Use base algorithm
        return os.path.join(root_dir, "algorithm.py")
    
    # Handle both old format (numeric) and new format (genXX-XXX)
    if re.match(r'^[0-9]+$', based_on_id):
        # Old numeric format
        return os.path.join(output_dir, f"evolution_id{based_on_id}.py")
    else:
        # New generation format
        return os.path.join(output_dir, f"evolution_{based_on_id}.py")

def get_output_file_path(id_val, output_dir):
    """Get the output file path based on id."""
    # Handle both old format (numeric) and new format (genXX-XXX)
    if re.match(r'^[0-9]+$', id_val):
        # Old numeric format
        return os.path.join(output_dir, f"evolution_id{id_val}.py")
    else:
        # New generation format
        return os.path.join(output_dir, f"evolution_{id_val}.py")

def main():
    """Main entry point for standalone testing."""
    if len(sys.argv) < 7:
        print("Usage: evolution_processor.py <id> <based_on_id> <output_dir> <root_dir> <parent_file> <output_file>")
        sys.exit(1)
    
    id_val = sys.argv[1]
    based_on_id = sys.argv[2]
    output_dir = sys.argv[3]
    root_dir = sys.argv[4]
    parent_file = sys.argv[5]
    output_file = sys.argv[6]
    
    skip_copy, skip_claude, reason = should_skip_processing(id_val, based_on_id, parent_file, output_file)
    
    print(f"skip_copy={skip_copy}")
    print(f"skip_claude={skip_claude}")
    print(f'reason="{reason or ""}"')

if __name__ == "__main__":
    main()