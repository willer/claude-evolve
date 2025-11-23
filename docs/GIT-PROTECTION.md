# Git Protection Strategy for Claude-Evolve

## The Problem

AI agents in claude-evolve have been reverting git versions, causing data loss. This document outlines the multi-layered protection strategy.

## Root Cause

1. `--dangerously-skip-permissions` flag allows git commands to execute without confirmation
2. Git warnings buried in prompts are easy for AI to miss or ignore
3. No technical safeguards preventing git operations

## Multi-Layer Protection Strategy

### Layer 1: Prominent Prompt Warnings (IMMEDIATE)

Add to the TOP of EVERY AI prompt:

```
⚠️ ═══════════════════════════════════════════════════════════════════════════
⚠️ ABSOLUTELY CRITICAL - GIT OPERATIONS STRICTLY FORBIDDEN
⚠️ ═══════════════════════════════════════════════════════════════════════════
⚠️
⚠️ YOU ARE ABSOLUTELY FORBIDDEN FROM USING ANY GIT COMMANDS WHATSOEVER.
⚠️
⚠️ FORBIDDEN COMMANDS (this list is not exhaustive - NO git operations allowed):
⚠️   - git commit, git add, git reset, git checkout, git revert
⚠️   - git branch, git merge, git pull, git push, git fetch
⚠️   - git stash, git clean, git rm, git mv
⚠️   - ANY command starting with 'git'
⚠️
⚠️ WHY: This system runs in production environments. Git operations have caused
⚠️      data loss multiple times. Version control is managed by the human operator.
⚠️
⚠️ WHAT TO DO INSTEAD: Only modify files directly using file editing tools.
⚠️                     Do NOT touch version control under any circumstances.
⚠️
⚠️ IF YOU USE ANY GIT COMMAND, YOU WILL CORRUPT THE EVOLUTION RUN.
⚠️
⚠️ CONSEQUENCES: If ANY git command is executed, the human operator will be forced
⚠️              to SHUT DOWN ALL AI-BASED EVOLUTION WORK and switch to manual-only
⚠️              mode. You will cause the termination of the entire automated system.
⚠️ ═══════════════════════════════════════════════════════════════════════════
```

### Layer 2: MCP Configuration (RECOMMENDED)

Create `.claude/mcp-blocked-tools.json` to block git at the MCP level:

```json
{
  "blocked_commands": [
    "git",
    "gh"
  ],
  "blocked_patterns": [
    "^git\\s",
    "git.*commit",
    "git.*reset",
    "git.*checkout"
  ]
}
```

Then use `--mcp-config .claude/mcp-blocked-tools.json` instead of empty string.

### Layer 3: Remove Dangerous Permissions (RECOMMENDED)

Change all AI CLI calls to REMOVE `--dangerously-skip-permissions`:

**BEFORE:**
```bash
claude --dangerously-skip-permissions --mcp-config '' --model opus -p "$prompt"
```

**AFTER:**
```bash
claude --mcp-config '' --model opus -p "$prompt"
```

This forces user confirmation for ANY destructive operations, including git.

### Layer 4: Sandboxing (FUTURE)

Consider running AI operations in Docker containers or chroot jails where git isn't available.

## Implementation Status

✅ **IMPLEMENTED (2025-01-22):**
- [x] Created `get_git_protection_warning()` function in `lib/ai-cli.sh`
- [x] Added ultra-prominent git warning to ALL ideate prompts (novel, hill-climbing, structural, crossover, legacy)
- [x] Added ultra-prominent git warning to worker evolution prompt
- [x] Removed redundant buried git warnings from all prompts
- [x] Warning is now the FIRST thing every AI sees (impossible to miss)
- [x] Visual design with !!!, ⛔, ❌, ⚠️, ✅, 💀 symbols for maximum visibility
- [x] Documented in GIT-PROTECTION.md

🔄 **DECISION - NOT IMPLEMENTED:**
- [ ] ~~Remove --dangerously-skip-permissions~~ - CANNOT DO: Required for automated file editing
- [ ] ~~Create MCP config to block git~~ - Not implemented yet (optional enhancement)

📝 **TODO (Future Enhancements):**
- [ ] Add pre-commit hook to verify git warning exists in all AI prompts
- [ ] Consider MCP-level git blocking if technically feasible
- [ ] Monitor logs for any git command attempts
- [ ] Add automated test that verifies warning is in all prompts

## Implementation Checklist

- [x] Add prominent git warning to claude-evolve-ideate (all strategy prompts)
- [x] Add prominent git warning to claude-evolve-worker (evolution prompt)
- [x] Add prominent git warning to any other AI-calling code
- [x] Create reusable warning function in lib/ai-cli.sh
- [ ] ~~Remove --dangerously-skip-permissions~~ (Cannot - breaks file editing)
- [ ] Create MCP config to block git commands (Optional future enhancement)
- [ ] Test that git operations are actually blocked
- [ ] Add pre-commit hook to detect missing git warnings
- [x] Document this for future maintainers

## Testing

After implementing, test that an AI CANNOT execute:
```bash
# Should fail or require confirmation
echo "Run: git status" | claude -p -
```

## Recovery from Git Corruption

If an AI has corrupted git:

```bash
# Check what happened
git reflog

# Find the commit before corruption (e.g., abc123)
git reset --hard abc123

# Force push if needed (BE CAREFUL)
git push --force origin main
```
