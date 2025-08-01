#!/bin/bash
# Test ideation with detailed debugging

# Set up test environment
export VERBOSE_AI_OUTPUT=true
export DEBUG_AI_CALLS=true
export DEBUG_AI_SUCCESS=true

# Create a minimal test evolution directory
test_dir="test-evolution"
rm -rf "$test_dir"
mkdir -p "$test_dir"

# Create minimal files
cat > "$test_dir/config.yaml" << 'EOF'
algorithm_file: "algorithm.py"
evaluator_file: "evaluator.py"
brief_file: "BRIEF.md"
evolution_csv: "evolution.csv"
output_dir: ""

ideation_strategies:
  total_ideas: 3
  novel_exploration: 1
  hill_climbing: 1
  structural_mutation: 1
  crossover_hybrid: 0
  num_elites: 2

python_cmd: "python3"
auto_ideate: false

parallel:
  enabled: false

llm_cli:
  o3: 'codex exec -m o3 --dangerously-bypass-approvals-and-sandbox "{{PROMPT}}"'
  codex: 'codex exec --dangerously-bypass-approvals-and-sandbox "{{PROMPT}}"'
  gemini: 'gemini -y -p "{{PROMPT}}"'
  opus: 'claude --dangerously-skip-permissions --model opus -p "{{PROMPT}}"'
  sonnet: 'claude --dangerously-skip-permissions --model sonnet -p "{{PROMPT}}"'
  
  run: sonnet
  ideate: o3 opus gemini
EOF

cat > "$test_dir/algorithm.py" << 'EOF'
# Test algorithm
def calculate(x):
    return x * 2
EOF

cat > "$test_dir/evaluator.py" << 'EOF'
# Test evaluator
print("SCORE: 1.0")
EOF

cat > "$test_dir/BRIEF.md" << 'EOF'
# Test Brief
This is a test algorithm that doubles input values.
EOF

cat > "$test_dir/evolution.csv" << 'EOF'
id,parent_id,description,performance,status
gen00-000,0,baseline algorithm,1.0,complete
gen01-001,gen00-000,test idea 1,1.1,complete
gen01-002,gen00-000,test idea 2,0.9,complete
EOF

echo "Test directory: $test_dir"
echo "Running ideation test..."
echo

# Run ideation with just 1 idea
export CLAUDE_EVOLVE_CONFIG="$test_dir/config.yaml"
./bin/claude-evolve ideate --legacy 1

echo
echo "CSV after ideation:"
cat evolution.csv

# Cleanup
# rm -rf "$test_dir"  # Keep for inspection