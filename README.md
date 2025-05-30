# claude-evolve

Automated algorithm evolution - let AI evolve your algorithms while you sleep.

## What is this?

claude-evolve is an automated algorithm evolution system that runs continuous evolution cycles without constant supervision. Start with a base algorithm and let it evolve optimized variants autonomously.

Think of it like **genetic algorithms for code** - it handles the mutations and testing, but you should keep an eye on the results and occasionally guide the evolution when needed.

### How the Evolution System Works

The system operates with specialized phases working together:

- 🧠 **Ideation Phase**: Generates creative algorithm variations using Claude Opus
- 🔬 **Development Phase**: Implements mutations using Claude Sonnet (with periodic Opus "megathinking")
- 📊 **Evaluation Phase**: Tests performance against your custom evaluator
- 📈 **Analysis Phase**: Tracks evolution progress and identifies top performers

The evolution cycle:
```
Ideate → Mutate → Evaluate → Analyze → Repeat
```

You can leave it running while you grab lunch or sleep - it just keeps evolving better algorithms until you stop it.

## Installation

```bash
npm install -g claude-evolve
```

## Quick Start

```bash
claude-evolve
```

The system will walk you through the setup process:

1. **Create evolution workspace** - Initialize the directory structure
2. **Write evolution/BRIEF.md** - Describe your optimization problem
3. **Customize evolution/evaluator.py** - Define how to measure algorithm performance
4. **Generate ideas** - Create initial algorithm candidates
5. **Start evolution** - Begin the automated evolution process

## Commands

### Main wrapper command
```bash
claude-evolve        # Interactive mode (recommended for beginners)
claude-evolve setup  # Initialize evolution workspace
claude-evolve ideate # Generate new algorithm ideas
claude-evolve run    # Execute evolution candidates
claude-evolve analyze # Analyze evolution results
claude-evolve config # Manage configuration settings
```

### Individual commands (if you know what you're doing)

#### claude-evolve-setup
Initializes your evolution workspace with:
- Directory structure
- Template files (BRIEF.md, algorithm.py, evaluator.py, config.yaml)
- CSV file for tracking evolution progress

#### claude-evolve-ideate
Generates new algorithm variation ideas using Claude Opus in megathinking mode:
- Reads your project brief
- Analyzes top-performing algorithms so far
- Creates creative mutations and variations
- Defaults to 20 ideas per run (configurable)

#### claude-evolve-run
Executes the next evolution candidate:
- Picks the next untested idea from your CSV
- Uses Claude to implement the mutation
- Runs your evaluator to measure performance
- Records results and updates the evolution log
- Every 4th iteration uses Opus for architectural thinking

#### claude-evolve-analyze
Analyzes evolution progress and generates insights:
- Performance trends over time
- Best-performing algorithm variants
- Suggestions for future evolution directions

#### claude-evolve-config
Manages configuration settings:
- View current configuration
- Edit paths and behavior settings
- Reset to defaults

## How it Works

1. **Set up evolution workspace** - Define your optimization problem
2. **Create base algorithm** - Start with `evolution/algorithm.py`
3. **Define evaluation criteria** - Customize `evolution/evaluator.py`
4. **Generate initial ideas** - Run `claude-evolve ideate` to create variations
5. **Start evolution loop** - The system automatically:
   - Picks the next candidate from your CSV
   - Implements the mutation
   - Evaluates performance
   - Records results
   - Repeats until you stop it

## Monitoring Progress (Like Genetic Algorithms)

This isn't sci-fi level "sleep through the entire evolution" automation - it's more like controlled genetic algorithms. The system handles most mutations, but you should monitor it and guide the evolution when needed.

**Recommended monitoring approach:**
- **Check evolution.csv** - Track performance of all variants
- **Review top performers** - Look at the best algorithms generated so far
- **Monitor for convergence** - Watch for diminishing returns or local optima
- **Inject new ideas** - Add manual variations when evolution stagnates

**When you need to guide evolution:**
- **Add targeted ideas** - Use `claude-evolve ideate` with specific directions
- **Modify the evaluator** - Update `evolution/evaluator.py` to change selection pressure
- **Restart from best** - Copy top performer to `algorithm.py` and continue evolving
- **The system adapts** - New ideas will build on your guidance

**Interruptible design:**
- Hit Ctrl+C anytime to pause
- Restart later with `claude-evolve run`
- Perfect for running overnight, during meetings, or while getting lunch

## Requirements

### Required
- Node.js >= 14.0.0
- Python 3.x (for algorithm execution)
- Unix-like environment (macOS, Linux)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)

### Optional (but recommended)
- Scientific Python libraries (numpy, scipy, etc.) depending on your algorithms
- Plotting libraries (matplotlib, plotly) for analyzing results

## Project Structure

Your evolution workspace will have:
```
your-project/
├── evolution/
│   ├── BRIEF.md           # Problem description and goals
│   ├── algorithm.py       # Base algorithm to evolve
│   ├── evaluator.py       # Performance evaluation logic
│   ├── config.yaml        # Configuration settings
│   ├── evolution.csv      # Evolution progress tracking
│   ├── evolution_id1.py   # Generated algorithm variants
│   ├── evolution_id2.py
│   └── ...
└── (your main project files)
```

## Configuration

Edit `evolution/config.yaml` to customize:

```yaml
# Working directory for evolution files
evolution_dir: "evolution"

# Algorithm and evaluator file paths
algorithm_file: "algorithm.py"
evaluator_file: "evaluator.py"
brief_file: "BRIEF.md"

# CSV file for tracking evolution
evolution_csv: "evolution.csv"

# Parent algorithm selection strategy
parent_selection: "best"  # or "random", "latest"

# Maximum number of ideas to generate at once
max_ideas: 50

# Python command to use for evaluation
python_cmd: "python3"
```

## Tips for Success

1. **Write a clear BRIEF.md** - Describe your optimization problem, constraints, and goals
2. **Create a robust evaluator** - Your evaluator.py determines evolution direction
3. **Start simple** - Begin with a basic algorithm and let evolution add complexity
4. **Monitor early cycles** - Watch the first few evolutions to ensure proper setup
5. **Guide when stuck** - Add manual ideas when evolution hits local optima
6. **Embrace failures** - Not every mutation will be better, that's how evolution works

## Example Use Cases

- **Algorithm optimization** - Improve sorting, searching, or mathematical algorithms
- **Machine learning** - Evolve model architectures or training procedures
- **Game AI** - Develop and optimize game-playing strategies
- **Numerical methods** - Improve solvers, optimizers, or approximation algorithms
- **Data structures** - Evolve efficient data organization strategies

## License

MIT