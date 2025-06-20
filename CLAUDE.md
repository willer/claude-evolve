# Claude Evolution Project Guidelines

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