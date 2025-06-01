# claude-evolve

Automated algorithm evolution - let AI evolve your algorithms while you sleep.

## What is this?

claude-evolve is an automated algorithm evolution system that runs continuous evolution cycles without constant supervision. Start with a base algorithm and let it evolve optimized variants autonomously.

Think of it like **genetic algorithms for code** - it handles the mutations and testing, and runs **indefinitely** until you stop it. The system automatically generates new ideas when it runs out of candidates.

### How the Evolution System Works

The system operates with specialized phases working together:

- 🧠 **Ideation Phase**: Generates creative algorithm variations using Claude Opus
- 🔬 **Development Phase**: Implements mutations using Claude Sonnet (with periodic Opus "megathinking")
- 📊 **Evaluation Phase**: Tests performance against your custom evaluator
- 📈 **Analysis Phase**: Tracks evolution progress and identifies top performers

The evolution cycle:
```
Ideate → Mutate → Evaluate → (Auto-Generate New Ideas) → Repeat Forever
```

**Truly autonomous evolution**: The system runs indefinitely, automatically generating new generations of ideas when it exhausts current candidates. You can leave it running overnight, over the weekend, or while you work on other things - it just keeps evolving better algorithms until you manually stop it with Ctrl+C.

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
Generates new algorithm variation ideas using multi-strategy evolutionary approach:
- **Novel exploration** - Pure creativity for global search
- **Hill climbing** - Parameter tuning of top performers
- **Structural mutation** - Algorithmic changes to successful designs  
- **Crossover hybrid** - Combines successful approaches
- Uses Claude Opus in megathinking mode for each strategy
- Configurable strategy distribution (default: 3+5+3+4 = 15 ideas)

#### claude-evolve-run
Executes evolution candidates in an **infinite loop**:
- Picks the next untested idea from your CSV
- Uses Claude to implement the mutation
- Runs your evaluator to measure performance
- Records results and updates the evolution log
- **When no candidates remain**: Automatically generates new ideas and continues
- **Runs forever until manually stopped** (Ctrl+C)

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
   - **Generates new ideas when candidates are exhausted**
   - **Repeats forever until manually stopped**

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

**Infinite evolution with manual control:**
- **Runs forever** - automatically generates new generations of ideas
- **Hit Ctrl+C anytime** to stop the evolution process
- **Restart later** with `claude-evolve run` to continue from where you left off
- **Perfect for long-term optimization** - run overnight, over weekends, or while working on other projects

## Handling Failures and Recovery

Evolution experiments can fail for various reasons. The system tracks these failures and provides recovery options.

**Common failure types:**
- **Infrastructure failures** - Missing dependencies (e.g., xgboost not installed)
- **Code generation bugs** - Claude occasionally generates syntactically incorrect code
- **Evaluation errors** - Evaluator crashes or returns invalid output
- **Performance score 0** - Algorithm runs but produces no meaningful results (now marked as "failed")

**Failure tracking in evolution.csv:**
- `failed` - Evaluation error or performance score of 0
- `timeout` - Evaluation exceeded time limit
- `interrupted` - User interrupted with Ctrl+C
- Check the `status` column to identify failed candidates

**Manual recovery strategies:**
1. **Force retry of failed candidates:**
   - Edit `evolution.csv` and change status from "failed" to "pending"
   - Clear the performance value for that row
   - Run `claude-evolve run` to retry the candidate

2. **Fix infrastructure issues:**
   - Install missing dependencies: `pip install xgboost numpy scipy`
   - Update Python environment if needed
   - Check that evaluator.py has proper error handling

3. **Guide around persistent failures:**
   - If a specific approach keeps failing, add constraints to BRIEF.md
   - Use `claude-evolve ideate` with explicit directions to avoid problematic patterns
   - Consider updating evaluator.py to catch and handle specific error types

**Future auto-recovery (planned):**
- Automatic retry with different prompts for code generation failures
- Dependency detection and installation suggestions
- Smart failure pattern recognition to avoid similar mutations

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

# Multi-strategy ideation configuration
ideation_strategies:
  total_ideas: 15           # Total ideas per generation
  novel_exploration: 3      # Pure creativity, global search
  hill_climbing: 5          # Parameter tuning of top performers
  structural_mutation: 3    # Algorithmic changes to top performers
  crossover_hybrid: 4       # Combine successful approaches
  num_elites: 3            # Number of top performers to use as parents

# Python command to use for evaluation
python_cmd: "python3"
```

### Understanding the Multi-Strategy Approach

The ideation system uses evolutionary algorithm principles with four complementary strategies:

**🎯 Novel Exploration (Global Search)**
- Generates completely new algorithmic approaches
- Prevents getting stuck in local optima
- Explores different paradigms, data structures, mathematical approaches
- Essential for breakthrough innovations

**⛰️ Hill Climbing (Exploitation)**  
- Fine-tunes parameters of successful algorithms
- Adjusts constants, thresholds, iteration counts
- Quick wins through incremental improvements
- Builds on proven approaches

**🔧 Structural Mutation (Medium-Distance Search)**
- Redesigns implementation while keeping core insights
- Changes data structures, sub-algorithms, execution patterns
- Balances innovation with proven concepts
- Explores architectural variations

**🧬 Crossover Hybrid (Recombination)**
- Combines successful elements from different top performers  
- Creates novel interactions between proven approaches
- Leverages diversity in the population
- Often produces unexpected breakthrough combinations

**⚖️ Strategy Balance**
The default 3+5+3+4 distribution provides:
- 20% wild exploration (escape local maxima)
- 33% focused exploitation (quick improvements)  
- 20% structural innovation (medium jumps)
- 27% recombination (leverage diversity)

**🎛️ Tuning Your Evolution**
Adjust ratios based on your needs:
- **Stuck in local optimum?** Increase `novel_exploration` and `structural_mutation`
- **Need incremental gains?** Increase `hill_climbing`
- **Population too similar?** Increase `crossover_hybrid`
- **Want faster convergence?** Decrease `total_ideas`, increase `hill_climbing`

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