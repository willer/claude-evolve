#!/usr/bin/env python3
"""
Baseline algorithm template for claude-evolve.

This is the starting point for evolution. Replace this with your
actual algorithm implementation.
"""


def example_algorithm(data):
    """
    Example algorithm that can be evolved.
    
    Args:
        data: Input data to process
        
    Returns:
        Processed result
    """
    # TODO: Replace this with your actual algorithm
    return sorted(data)


def main():
    """Example usage of the algorithm."""
    test_data = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
    result = example_algorithm(test_data)
    print(f"Input: {test_data}")
    print(f"Output: {result}")


if __name__ == "__main__":
    main()