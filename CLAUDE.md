# Claude Evolve

This is an npm package, which is built to re-implement the ideas behind AlphaEvolve by Google.
The basic idea is to run an evolutionary search to find the best algorithm to suit a particular
performance criteria. caude-evolve itself doesn't care what type of algorithm, it just runs
the process:

a) tell AI's to ideate new ideas based on the best ones in evolution.csv (using BRIEF.md as the explanation)
b) for each idea in "pending" state in the evolution.csv file, get an AI to write the code for it
c) for each new algorithm code, run evaluator.py on the new code to determine its performance (i.e. fitness) value
d) save "completed" state in the csv for that algorithm, and record the performance in the csv
e) go to (a)

Each evolution is like a greenhouse, growing plants one generation at a time. The user must 
fill out BRIEF.md, algorithm.py (the first "plant"), and evaluator.py, and then claude-evolve
will take it from there.


## Evaluator Output Specification

The claude-evolve system supports multiple evaluator output formats to provide flexibility in performance reporting:

### Supported Output Formats

1. **Simple Numeric Value** - Just print a number:
   ```
   1.234
   ```

2. **JSON with performance field** (Recommended for multiple metrics):
   ```json
   {"performance": 1.234, "accuracy": 0.95, "latency": 45.2, "memory_mb": 128}
   ```
   
   The system will extract the `performance` field for evolution decisions and save ALL fields to the CSV.

3. **JSON with score field** (Alternative to performance):
   ```json
   {"score": 1.234, "precision": 0.88, "recall": 0.92}
   ```

4. **Legacy SCORE: format** (For backward compatibility):
   ```
   SCORE: 1.234
   ```

### Important Notes
- Performance values can be any numeric value (including 0.0)
- A score of 0.0 is NOT a failure - it's just a low performance score
- To indicate evaluation failure, exit with non-zero status code
- When using JSON, all fields are preserved in the CSV for later analysis
- The worker will automatically detect and parse any of these formats

## Shell Script Best Practices

### CRITICAL: Proper use of `local` keyword

The `local` keyword in bash can **ONLY** be used inside functions. This is a common mistake that causes runtime errors.

**❌ WRONG - Using local in main script body:**
```bash
#!/bin/bash
local my_var="value"  # ERROR: local: can only be used in a function
```

**✅ CORRECT - Using local inside functions:**
```bash
#!/bin/bash
my_function() {
  local my_var="value"  # OK: inside a function
}

# In main script body, just declare variables without 'local'
my_var="value"  # OK: no local keyword
```

### Common patterns to avoid:

1. **In while loops at script level:**
```bash
# ❌ WRONG
while true; do
  local temp_var="something"  # ERROR!
done

# ✅ CORRECT
while true; do
  temp_var="something"  # No local keyword
done
```

2. **In if statements at script level:**
```bash
# ❌ WRONG
if [[ $condition ]]; then
  local result="value"  # ERROR!
fi

# ✅ CORRECT
if [[ $condition ]]; then
  result="value"  # No local keyword
fi
```

### Rule of thumb:
- Inside a function → use `local` for function-scoped variables
- Outside a function → never use `local`
- When in doubt → check if you're inside a function definition

## Other Shell Script Guidelines

### Path handling
- Always use absolute paths when possible
- Be consistent with path resolution across different execution contexts
- Test scripts from different working directories

### Error handling
- Always check return codes for critical operations
- Use `set -e` at the top of scripts to exit on errors
- Provide clear error messages with context

### CSV file handling
- Ensure consistent field counting across all CSV operations
- Handle both empty fields and missing fields gracefully
- Always redirect grep errors to avoid output corruption: `grep -c pattern file 2>/dev/null`

### Debugging
- Use `>&2` to send debug messages to stderr, not stdout
- Add debug flags/modes for troubleshooting
- Log operations that modify data

## Project-Specific Notes

### Evolution Processing
- If a file exists, skip all processing (copy and Claude)
- Keep logic simple - avoid complex edge case handling
- Baseline algorithms (id=000, 0, gen00-000) always skip processing

### Parallel Execution
- Lock files should auto-cleanup after 10 seconds
- CSV operations should be fast (<100ms)
- Handle crashed workers gracefully

### Configuration
- Support both relative and absolute paths in config files
- Make path resolution work regardless of working directory
- Always validate configuration before use
