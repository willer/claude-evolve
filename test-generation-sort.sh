#!/bin/bash
# Test generation sorting with triple-digit numbers

echo "Testing generation sorting..."
echo

# Create test list of generations
test_gens="gen1 gen2 gen10 gen20 gen99 gen100 gen101 gen200"

echo "Original order: $test_gens"
echo

echo "Alphabetical sort (BAD):"
echo "$test_gens" | tr ' ' '\n' | sort
echo

echo "Numeric sort (GOOD):"
echo "$test_gens" | tr ' ' '\n' | awk '{print substr($0,4), $0}' | sort -n | cut -d' ' -f2
echo

# Test with the actual Python sorting from status
echo "Python numeric sort (status command):"
python3 -c "
gens = 'gen1 gen2 gen10 gen20 gen99 gen100 gen101 gen200'.split()
sorted_gens = sorted(gens, key=lambda g: int(g[3:]) if g.startswith('gen') and g[3:].isdigit() else 0)
print(' '.join(sorted_gens))
"