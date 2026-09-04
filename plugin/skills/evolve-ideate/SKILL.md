---
name: evolve-ideate
description: Run one generation of ideation for a claude-evolve workspace. Reads the top performers, BRIEF, and accumulated notes, then runs parallel ideation branches — three isolated framed branches for novel exploration plus one each for hill climbing, structural mutation, and crossover. Each branch rolls its idea source — Fable (xhigh, via one ideator subagent) or an external model run directly by script (codex GPT-6 Astra, GLM, Kimi, Qwen) — then the best ideas are selected and appended as pending rows in evolution.csv. Use when the user says "ideate", "generate new ideas", "make the next generation", or when the omnibus evolve loop drains its pending queue. Run only ONE ideation at a time per workspace.
argument-hint: "[--working-dir DIR] [count]"
---

# evolve-ideate

Generate the next batch of candidate ideas for an evolution workspace. It fans out parallel branches — three isolated, differently-framed branches for novel exploration (best-of-pool selection afterward) plus one per remaining strategy — each proposing variants grounded in the current best performers and the BRIEF, then writes the winners to `evolution.csv` as `pending` rows for the coding/scoring loop to pick up.

Every branch's prompt is assembled by `scripts/ideate_branch.py` from the context JSON — never by hand, and never inlined into an `Agent` call. A `fable` branch is ONE `claude-evolve:ideator` subagent that reads the prompt file; an external branch (`codex`/`glm`/`kimi`/`qwen`) is the script running that CLI itself, with no subagent at all. That is what keeps this skill cheap: the orchestrator never carries the BRIEF, notes, or thousands of descriptions in its own context, and no Fable turn is spent wrapping a codex call.

> **One at a time.** Two concurrent ideation runs would race on candidate IDs and generation numbering. This skill takes a lock and refuses to start if another ideation is in progress for the same workspace.

## Step 1 — Resolve plugin root, build context, take the lock

```bash
PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"
WS=<WORKING_DIR>
RUN=/tmp/evolve-ideate/$(basename "$WS")-$(date +%s); mkdir -p "$RUN"
python3 "$PLUGIN_ROOT/scripts/evolve_csv.py" --working-dir "$WS" context --n 5 > "$RUN/ctx.json"
python3 -c "
import json; d=json.load(open('$RUN/ctx.json'))
print({k:(v if k not in ('brief','notes','existing_descriptions','top_performers','cross_evolution_wins') else '<%d>'%len(v)) for k,v in d.items()})
for p in d['top_performers'][:8]: print(' ', p['id'], p['basedOnId'], round(p['performance'],6), p['description'][:110].replace(chr(10),' '))"
```

Print the summary only — do NOT `cat` ctx.json; it can be megabytes. The summary gives you `generation`, `evolution_dir`, `total_ideas`, `strategies`, and `novel_intents` (name → `{count, rule}`).

Take the lock (auto-expires after 30 min in case a prior run crashed):

```bash
LK="<evolution_dir>/.evolve-ideate.lock"
[ -n "$(find "$LK" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rm -rf "$LK"
if mkdir "$LK" 2>/dev/null; then echo "LOCK_ACQUIRED"; else echo "LOCK_HELD"; fi
```

If `LOCK_HELD`: tell the user ideation is already running for this workspace and stop. Otherwise continue. **Always `rm -rf "$LK"` before you finish**, including on error.

## Step 2 — Allocate IDs, split by strategy, roll sources and frames

If the user gave a `count`, use it; otherwise use `total_ideas`. Reserve the IDs:

```bash
python3 "$PLUGIN_ROOT/scripts/evolve_csv.py" --working-dir "$WS" next-ids <generation> <count>
```

Split them across the four strategies by the `strategies` counts (skip any with count 0). Each strategy gets a disjoint slice. If the caller (user or a loop session) reports a knob-tweak plateau, shift hill-climbing slots to structural/novel — that is a judgment call you are allowed to make; say so in the report.

**Intents.** If `novel_intents` is non-empty, split the novel slice by its counts in the order the intents appear: the first `count` IDs carry the first intent, the next slice the second, and so on; leftover novel IDs are FREE. Build the `--intents` JSON (`{"<id>":"<intent name>"}`) for the novel branches. The harness carries each intent's `rule` text into the prompt verbatim and never interprets it.

**Sources.** Roll once per branch — 1/6 `codex` (GPT-6 Astra, xhigh), 1/6 `glm`, 1/6 `kimi`, 1/6 `qwen`, otherwise `fable`. Model IDs live in `scripts/ideate_branch.py`, not here.

```bash
for s in novel_A novel_B novel_C hill_climbing structural_mutation crossover_hybrid; do
  r=$(( RANDOM % 6 ))
  case $r in 0) src=codex;; 1) src=glm;; 2) src=kimi;; 3) src=qwen;; *) src=fable;; esac
  echo "$s=$src"
done
```

**Frames.** Roll four distinct frames: the first three go to the novel branches, the fourth to structural_mutation. Hill climbing and crossover get none — they are convergent by design. The frame texts live in the script (`FRAMES`).

```bash
printf '%s\n' inversion biology remove_assumption crudest maximalist speedrunner transplant oncall | sort -R | head -4
```

## Step 3 — Launch the branches

For EVERY branch, run the script once. It writes `<out>.prompt.txt` and, for external sources, runs the CLI and writes the parsed ideas into `<out>`:

```bash
python3 "$PLUGIN_ROOT/scripts/ideate_branch.py" --working-dir "$WS" --context-file "$RUN/ctx.json" \
  --out "$RUN/<branch>.json" --source <src> --strategy <strategy> --ids <id1,id2,...> \
  [--frame <frame>] [--intents '<json>'] [--extra "<caller context: plateau facts, closed axes, constraints>"]
```

`--extra` is where the caller's situational context goes (e.g. "twelve candidates tie exactly at X — knob sweeps on axes A/B/C are inert; propose structural changes only"). Pass the same `--extra` to every branch.

- **External branches (`codex`/`glm`/`kimi`/`qwen`):** launch each script call with Bash `run_in_background: true`, all in one message. No `timeout` wrapper (the script has its own 30-min budget). You are notified when each exits. A branch that fails writes `"status":"error"|"timeout"` with the reason — report it as such; there is no fallback to another model.
- **Fable branches:** run the script in the FOREGROUND (it only writes the prompt and exits instantly), then launch one `Agent` per branch with `subagent_type: "claude-evolve:ideator"` (no `model` override) and this prompt — nothing else:

  ```
  Read /tmp/evolve-ideate/<...>/<branch>.json.prompt.txt with the Read tool and answer it. Return ONLY the JSON array it asks for.
  ```

`novel_exploration` runs as **three branches** (novel_A/B/C). All three get the same full slate of novel IDs, the same intents, and the same `--extra`, but each gets its own frame and source, and none sees the others' output. That isolation is the point: branches that see each other collapse into one wider thought. You pool their ~3× ideas in Step 4. The other three strategies run one branch each.

Launch everything in parallel: the background script calls and the `Agent` calls all go in one message.

## Step 4 — Collect, select, dedup, append

External branches: read `"ideas"` from each `<out>` JSON. Fable branches: parse the subagent's returned JSON array.

**Select the novel winners.** You hold ~3× ideas for N novel slots. If intents are assigned, select **per intent group**: pool the branches' candidates for each intent's slots (and for FREE) and pick that group's best — never promote across groups. Within each pool drop near-duplicates, then keep the best by novelty (distance from existing descriptions and from each other) and fit (does it plausibly attack the BRIEF's metric); prefer a diverse set over N variations of one angle. **Enforce intents honestly:** disqualify any intent-slot candidate that violates its rule, however promising — the quota exists because such ideas outcompete everything else at selection. If a pool has no compliant candidate, leave those slots unfilled and say so; never backfill from another group. Verify each winner's description starts with its `[<INTENT NAME>] ` tag (add it if the branch forgot; FREE ideas carry no tag). Reassign the reserved novel IDs to the winners in order, keeping each winner on a slot of its own intent. Remember which branch each winner came from.

Then drop any idea (all strategies) whose description is a near-duplicate of an existing description or of another new idea. Keep the reserved IDs; don't invent new ones.

Tag each survivor's `idea-LLM` with its branch's source (`fable`, `codex`, `glm`, `kimi`, `qwen`) — non-novel IDs are disjoint per strategy so map by ID slice; novel winners by the branch that produced them.

Append the survivors in one call:

```bash
python3 "$PLUGIN_ROOT/scripts/evolve_csv.py" --working-dir "$WS" \
  append-ideas '[{"id":"gen03-001","basedOnId":"","description":"...","idea-LLM":"fable"},{"id":"gen03-002","basedOnId":"gen02-004","description":"...","idea-LLM":"codex"},...]'
```

It prints `{"added": N}`.

## Step 5 — Release + report

`rm -rf "$LK"`, then report one line: `Ideated generation <N>: added <added>/<count> ideas (<dropped> dropped as duplicates; <failed branches>, if any)`. Don't paste the idea list unless asked — it's in the CSV.

## Honesty

- If a branch fails or times out, append what the others produced and say which branch failed and why. Don't pad with filler to hit the count — for novel slots, two branches' pool is still a pool.
- If the caller asked for an explicit "converged / nothing non-inert left" verdict and the branches genuinely produced nothing that clears the bar, append nothing and say exactly that.
- If the BRIEF is empty or there are no completed performers yet, novel_exploration can still run, but say the context was thin.
