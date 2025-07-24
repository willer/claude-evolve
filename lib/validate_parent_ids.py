#!/usr/bin/env python3
"""
Validate parent IDs in AI-generated ideas for claude-evolve ideation.
"""

import csv
import json
import sys
import re
from typing import List, Set, Dict, Tuple, Optional


def get_valid_parent_ids(csv_path: str) -> Set[str]:
    """Extract all valid candidate IDs from the CSV that can be used as parents."""
    valid_ids = set()
    valid_ids.add("")  # Empty string is valid for novel ideas
    valid_ids.add("000")  # Special ID for baseline algorithm
    valid_ids.add("0")  # Alternative baseline ID
    valid_ids.add("gen00-000")  # Another baseline format
    
    try:
        with open(csv_path, 'r') as f:
            reader = csv.reader(f)
            next(reader, None)  # Skip header
            for row in reader:
                if row and len(row) > 0:
                    candidate_id = row[0].strip()
                    if candidate_id:
                        valid_ids.add(candidate_id)
    except Exception as e:
        print(f"[ERROR] Failed to read CSV: {e}", file=sys.stderr)
        
    return valid_ids


def validate_and_fix_parent_id(parent_id: str, valid_ids: Set[str], idea_type: str, 
                                top_performers: Optional[List[Tuple[str, str, float]]] = None) -> str:
    """
    Validate a parent ID and fix it if invalid.
    
    Args:
        parent_id: The parent ID to validate
        valid_ids: Set of valid parent IDs
        idea_type: Type of idea (novel, hill-climbing, structural, crossover)
        top_performers: List of (id, description, score) tuples for non-novel ideas
        
    Returns:
        A valid parent ID (may be fixed)
    """
    # Novel ideas should have empty parent
    if idea_type == "novel":
        return ""
    
    # Check if parent ID is valid
    if parent_id in valid_ids:
        return parent_id
    
    # For non-novel ideas, we need a valid parent
    if top_performers and len(top_performers) > 0:
        # Return the first top performer's ID
        return top_performers[0][0]
    
    # If no top performers, return empty (will be caught as error later)
    return ""


def parse_ai_line(line: str, idea_type: str) -> Tuple[str, str]:
    """
    Parse a line from AI output to extract parent ID and description.
    
    Returns:
        Tuple of (parent_id, description)
    """
    line = line.strip()
    parent_id = ""
    description = line
    
    if idea_type != "novel":
        # Look for "From X:" pattern
        match = re.match(r'^From\s+([^:]+):\s*(.+)$', line, re.IGNORECASE)
        if match:
            parent_id = match.group(1).strip()
            description = match.group(2).strip()
    
    return parent_id, description


def validate_ai_output(ai_output: str, count: int, idea_type: str, csv_path: str,
                      top_performers_str: str = "") -> List[Dict[str, str]]:
    """
    Validate AI output and return validated ideas.
    
    Args:
        ai_output: Raw AI output
        count: Expected number of ideas
        idea_type: Type of idea (novel, hill-climbing, structural, crossover)
        csv_path: Path to CSV file
        top_performers_str: String containing top performers (format: "id,description,score\n...")
        
    Returns:
        List of validated ideas with 'parent_id' and 'description' keys
    """
    # Get valid parent IDs
    valid_ids = get_valid_parent_ids(csv_path)
    
    # Parse top performers
    top_performers = []
    if top_performers_str:
        for line in top_performers_str.strip().split('\n'):
            if line:
                parts = line.split(',', 2)
                if len(parts) >= 3:
                    try:
                        top_performers.append((parts[0], parts[1], float(parts[2])))
                    except ValueError:
                        pass
    
    # Process AI output
    validated_ideas = []
    lines = ai_output.strip().split('\n')
    
    print(f"[DEBUG] Processing {len(lines)} lines from AI output for {idea_type} ideas", file=sys.stderr)
    
    for line in lines:
        # Skip empty lines and metadata
        if not line or line.strip() == '' or line.startswith('#') or line.startswith('[') or line.startswith('=='):
            continue
        
        # Skip debug/info messages from AI tools
        if line.strip().startswith('[INFO]') or line.strip().startswith('[WARN]') or line.strip().startswith('[ERROR]') or line.strip().startswith('[DEBUG]'):
            continue
        
        # Clean the line
        line = line.strip()
        line = re.sub(r'^[0-9]+\.?\s*', '', line)  # Remove numbering
        line = re.sub(r'^-\s*', '', line)  # Remove bullet points
        
        # Parse parent ID and description
        parent_id, description = parse_ai_line(line, idea_type)
        
        # Validate parent ID
        if parent_id and parent_id not in valid_ids:
            print(f"[WARN] Invalid parent ID '{parent_id}' for {idea_type} idea - fixing...", file=sys.stderr)
            print(f"[INFO] Valid parent IDs are: {', '.join(sorted([id for id in valid_ids if id]))[:200]}...", file=sys.stderr)
            parent_id = validate_and_fix_parent_id(parent_id, valid_ids, idea_type, top_performers)
            print(f"[INFO] Fixed parent ID to: '{parent_id}'", file=sys.stderr)
        
        # For non-novel ideas, ensure we have a parent
        if idea_type != "novel" and not parent_id:
            if top_performers:
                parent_id = top_performers[0][0]
                print(f"[INFO] Assigned parent ID '{parent_id}' to idea without parent", file=sys.stderr)
            else:
                print(f"[ERROR] Non-novel idea without parent and no top performers available", file=sys.stderr)
                continue
        
        # Skip if description is too short or contains shell artifacts
        if len(description) < 20:
            continue
        
        if any(word in description for word in ['EOF', '/dev/null', '<<<', '>>>', '#!/bin/bash']):
            print(f"[WARN] Skipping description with shell artifacts: {description[:50]}...", file=sys.stderr)
            continue
        
        validated_ideas.append({
            'parent_id': parent_id,
            'description': description
        })
        
        if len(validated_ideas) >= count:
            break
    
    return validated_ideas


def main():
    """Main entry point for validation script."""
    if len(sys.argv) < 5:
        print("Usage: validate_parent_ids.py <ai_output_file> <count> <idea_type> <csv_path> [top_performers_file]", file=sys.stderr)
        sys.exit(1)
    
    ai_output_file = sys.argv[1]
    count = int(sys.argv[2])
    idea_type = sys.argv[3]
    csv_path = sys.argv[4]
    top_performers_file = sys.argv[5] if len(sys.argv) > 5 else None
    
    try:
        # Read AI output
        with open(ai_output_file, 'r') as f:
            ai_output = f.read()
    except Exception as e:
        print(f"[ERROR] Failed to read AI output file {ai_output_file}: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Read top performers if provided
    top_performers_str = ""
    if top_performers_file and top_performers_file != "none":
        try:
            with open(top_performers_file, 'r') as f:
                top_performers_str = f.read()
        except Exception as e:
            print(f"[WARN] Failed to read top performers file {top_performers_file}: {e}", file=sys.stderr)
    
    # Check if AI output is empty or looks like an error
    if not ai_output.strip():
        print(f"[ERROR] AI output is empty", file=sys.stderr)
        sys.exit(1)
    
    if len(ai_output) < 50:
        print(f"[WARN] AI output is suspiciously short: {ai_output}", file=sys.stderr)
    
    # Validate
    validated_ideas = validate_ai_output(ai_output, count, idea_type, csv_path, top_performers_str)
    
    # Output validated ideas as JSON
    print(json.dumps(validated_ideas))
    
    # Return error ONLY if no valid ideas at all
    if len(validated_ideas) == 0:
        print(f"[ERROR] No valid ideas found in AI output. First 500 chars:", file=sys.stderr)
        print(ai_output[:500], file=sys.stderr)
        sys.exit(1)
    elif len(validated_ideas) < count:
        print(f"[WARN] Only validated {len(validated_ideas)} out of {count} requested {idea_type} ideas", file=sys.stderr)
        print(f"[INFO] AI appears to have generated fewer ideas than requested.", file=sys.stderr)
        print(f"[INFO] Proceeding with {len(validated_ideas)} valid ideas.", file=sys.stderr)
        # Don't exit with error - we have some valid ideas!


if __name__ == "__main__":
    main()