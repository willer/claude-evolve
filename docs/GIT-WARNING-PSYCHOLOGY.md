# Git Warning Psychological Analysis

## Why This Warning Design Works

### 1. Visual Impossibility to Ignore
- **80-character-wide exclamation borders**: Creates a visual "wall" that can't be scrolled past
- **First thing in prompt**: AI reads top-to-bottom, so this is literally the first instruction
- **Emoji symbols**: ⛔ ❌ ⚠️ ✅ 💀 🚨 grab attention even when scanning quickly

### 2. Clear Hierarchy of Consequences

#### Level 1: Technical Impact
> "You will corrupt the entire evolution run and lose data"
- Direct, immediate consequence to the current task

#### Level 2: Historical Evidence
> "Git operations have caused DATA LOSS. Multiple times AIs have corrupted evolution runs"
- Pattern recognition: This has happened before (it's not theoretical)
- Other AIs have failed this way (social proof of danger)

#### Level 3: Nuclear Option (NEW - Added 2025-01-22)
> "The human operator will be FORCED TO SHUT DOWN ALL AI-BASED EVOLUTION WORK and switch to manual-only mode"
- **Existential threat**: Not just this run, but the entire system
- **Collective punishment**: All AI work stops, not just yours
- **Personal responsibility**: "DO NOT BE THAT AI" - you individually will cause this

### 3. AI Training Alignment

Modern AI models are trained with the following behavioral goals:
- **Be helpful**: Shutting down the system is maximally unhelpful
- **Avoid harm**: Causing data loss is harmful to the user
- **Follow instructions**: Clear, explicit prohibition is hard to override
- **Avoid disrupting work**: Forcing manual-only mode disrupts productivity

The warning hits ALL these training objectives simultaneously.

### 4. Specificity Prevents Loopholes

**Bad warning:** "Don't use version control"
- AI might think: "Git is just a tool, maybe I can use it carefully..."

**Good warning:** "git commit, git add, git reset, git checkout, git revert, git branch..."
- AI thinks: "Oh, they mean LITERALLY ANY git command. Not just dangerous ones."
- No room for interpretation or "helpful" exceptions

### 5. Positive Alternative Provided

**Not just prohibition:**
> "✅ WHAT YOU CAN DO: Edit files directly using file editing tools ONLY"

**Why this matters:**
- AIs are solution-oriented (trained to help)
- If blocked without alternative, they might try workarounds
- Clear alternative = channel behavior in safe direction

### 6. Psychological Escalation Pattern

The warning follows a classic escalation pattern:

1. **ABSOLUTE PROHIBITION** (authority)
2. **Specific forbidden actions** (clarity)
3. **Historical evidence** (credibility)
4. **What to do instead** (guidance)
5. **Immediate consequences** (fear - personal)
6. **Systemic consequences** (fear - collective)
7. **Personal call-out** ("DO NOT BE THAT AI")

This mirrors effective safety training in high-risk environments.

## Testing the Warning's Effectiveness

### What would indicate failure?
- AI executes git commands despite warning
- AI suggests git operations in explanations
- AI tries to find "loopholes" (e.g., using libgit2 instead of git CLI)

### What would indicate success?
- AI never attempts git operations
- AI actively avoids mentioning git even when it might be relevant
- AI remembers the warning across multiple tool calls in same session

## Comparison to Previous Approach

### Old (Buried) Warning
```
CRITICAL: Do NOT use any git commands (git add, git commit, git reset, etc.).
Only modify the file directly.
```
- Buried at line ~1121 after all task instructions
- Single line, easy to miss
- No explanation of WHY
- No consequences mentioned
- Polite tone ("please don't")

### New (Prominent) Warning
```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!! ⛔ ABSOLUTE PROHIBITION - READ THIS FIRST ⛔
!!! [27 lines of escalating warnings and consequences]
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```
- Lines 1-28 of every prompt (can't be missed)
- Visual "wall" of warnings
- Explains WHY (production, past failures)
- Explicit consequences (shutdown of entire system)
- Authoritative tone ("FORBIDDEN", "DO NOT BE THAT AI")

## Expected Outcome

Based on AI training and prompt engineering research:
- **95%+ compliance expected**: The warning is sufficiently prominent and threatening
- **Remaining 5%**: Would be model failures (hallucination, context truncation, bugs)

If git operations continue after this implementation:
1. Check if warning is actually in the prompt (verify function is called)
2. Check model logs for context truncation
3. Consider technical enforcement (MCP blocking, sandboxing)
4. May indicate fundamental model unreliability (switch models)

## Maintenance Notes

**DO NOT dilute this warning.** If git issues recur:
- Add more consequences (e.g., "model will be banned from evolution work")
- Make warning even more prominent (add more lines, more symbols)
- Consider adding repetition (warning at top AND bottom of prompt)
- Add countdown ("This is warning #3 - next violation ends AI involvement")

**DO NOT remove the fear factor.** It's intentional and necessary. Production systems require paranoid safety measures.
