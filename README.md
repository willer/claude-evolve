# claude-evolve

Automated algorithm evolution using AI. Start with a base algorithm, let Claude evolve better variants autonomously.

## Install & Quick Start

```bash
# Install
npm install -g claude-evolve

# Set up project
claude-evolve setup

# Generate initial ideas
claude-evolve ideate

# Start evolution (runs forever until Ctrl+C)
claude-evolve run
```

## How It Works

1. **Write your problem** in `evolution/BRIEF.md`
2. **Create base algorithm** in `evolution/algorithm.py`  
3. **Define evaluation** in `evolution/evaluator.py`
4. **Generate ideas** - Claude creates algorithm variations
5. **Evolve automatically** - System tests variations, keeps best ones, generates new ideas

Evolution runs indefinitely until you stop it. Perfect for overnight optimization.

## Commands

```bash
claude-evolve           # Interactive menu
claude-evolve setup     # Initialize workspace
claude-evolve ideate    # Generate new algorithm ideas
claude-evolve run       # Start evolution loop (runs forever)
claude-evolve analyze   # View results and progress
claude-evolve status    # Quick progress overview
claude-evolve edit      # Manage candidate statuses
```

## Working with Multiple Projects

```bash
# Use different working directory
claude-evolve --working-dir=my-project run
claude-evolve --working-dir=experiments/trading ideate
```

## Project Structure

```
your-project/
├── evolution/
│   ├── BRIEF.md           # Problem description
│   ├── algorithm.py       # Base algorithm
│   ├── evaluator.py       # Performance measurement
│   ├── config.yaml        # Settings
│   ├── evolution.csv      # Progress tracking
│   └── evolution_*.py     # Generated variants
```

## Evaluator Requirements

Your `evaluator.py` must output a performance score to stdout. The system supports multiple output formats:

### Format 1: Simple numeric value
```python
# Just print a single number
print(1.234)
```

### Format 2: JSON with performance/score field
```python
# JSON with 'performance' field (recommended)
print('{"performance": 1.234, "accuracy": 0.95, "latency": 45.2}')

# OR JSON with 'score' field
print('{"score": 1.234, "precision": 0.88, "recall": 0.92}')
```

### Format 3: SCORE: prefix (legacy)
```python
# For backward compatibility
print("SCORE: 1.234")
```

**Important notes:**
- Higher scores = better performance
- When using JSON, all fields are saved to the CSV for analysis
- The `performance` or `score` field is required for evolution decisions
- Return value of 0 doesn't mean failure - it's just a low score
- Actual failures should exit with non-zero status code

## Configuration

Edit `evolution/config.yaml`:

```yaml
# Files
algorithm_file: "algorithm.py"
evaluator_file: "evaluator.py" 
evolution_csv: "evolution.csv"

# Evolution strategy
ideation_strategies:
  total_ideas: 15
  novel_exploration: 3    # Creative new approaches
  hill_climbing: 5        # Parameter tuning
  structural_mutation: 3  # Architecture changes
  crossover_hybrid: 4     # Combine best features

# Auto-generate new ideas when queue empty
auto_ideate: true

# Parallel execution
parallel:
  enabled: false
  max_workers: 4
```

## Requirements

- Node.js 14+
- Python 3.x
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
- Bash shell (Git Bash on Windows)

## Tips

- **Start simple** - Basic algorithm, let evolution add complexity
- **Monitor progress** - Check `evolution.csv` for performance trends
- **Guide evolution** - Add manual ideas when stuck in local optima
- **Let it run** - Evolution works best over long periods

## Common Issues

**Too many failures?** Check your evaluator handles edge cases and outputs valid scores.

**Stuck in local optimum?** Increase `novel_exploration` in config.yaml or add manual ideas.

**Evaluator crashes?** Make sure dependencies are installed and error handling is robust.

## License

MIT