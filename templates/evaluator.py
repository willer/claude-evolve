#!/usr/bin/env python3
"""
Default evaluator template for claude-evolve.

This script should:
1. Load and execute the algorithm file passed as argument
2. Run performance tests/benchmarks
3. Output JSON with performance metrics
4. Exit with code 0 for success, non-zero for failure
"""

import sys
import json
import importlib.util
from pathlib import Path


def load_algorithm(filepath):
    """Load algorithm from file."""
    spec = importlib.util.spec_from_file_location("algorithm", filepath)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load algorithm from {filepath}")
    
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def evaluate_performance(algorithm_module):
    """Evaluate algorithm performance and return metrics."""
    # TODO: Implement your specific performance evaluation logic
    
    # Example: timing a function call
    import time
    start_time = time.time()
    
    # Call your algorithm function here
    # result = algorithm_module.your_function(test_data)
    
    end_time = time.time()
    execution_time = end_time - start_time
    
    # Calculate a performance score (higher is better)
    score = 1.0 / execution_time if execution_time > 0 else 0
    
    return score  # Simple: just return the number


def main():
    if len(sys.argv) != 2:
        print("Usage: evaluator.py <algorithm_file>", file=sys.stderr)
        sys.exit(1)
    
    algorithm_file = Path(sys.argv[1])
    
    if not algorithm_file.exists():
        print(f"Algorithm file not found: {algorithm_file}", file=sys.stderr)
        sys.exit(1)
    
    try:
        algorithm_module = load_algorithm(algorithm_file)
        score = evaluate_performance(algorithm_module)
        
        # Option 1: Just print the number (simplest)
        print(score)
        
        # Option 2: Print as JSON (if you need more structure)
        # print(json.dumps({"score": score}))
        
        sys.exit(0)
    except Exception as e:
        # Log errors to stderr, not stdout
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()