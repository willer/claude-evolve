#!/usr/bin/env python3
"""
CSV interface for the claude-evolve plugin skills.

A thin, JSON-emitting CLI over the vendored EvolutionCSV engine. Skills call
this for every read/write of evolution.csv so the file-locking, ID generation,
and corruption handling all stay in the battle-tested engine.

Usage:
  evolve_csv.py [--working-dir DIR] <command> [args]

Commands:
  stats                       -> JSON {total,pending,complete,failed,running}
  ensure-baseline             -> add baseline-000 if missing
  cleanup                     -> remove dups, reset stuck, fix corrupted statuses
  claim-next                  -> atomically claim next pending (sets it running);
                                 prints JSON candidate {id,basedOnId,description} or null
  info <id>                   -> JSON candidate row or null
  set-status <id> <status>
  set-perf <id> <value>
  set-field <id> <col> <value>
  top-performers [--n N]      -> JSON list of best completed candidates
  context [--n N]             -> JSON ideation context (generation, top performers,
                                 brief, notes, existing descriptions, and
                                 cross_evolution_wins from sibling workspaces).
                                 [--siblings-root DIR] [--sibling-count N] [--no-siblings]
  next-ids <generation> <count>   -> JSON list of unused IDs for a generation
  append-ideas <json>         -> append ideas; <json> is a list of
                                 {id,basedOnId,description,idea-LLM?}
"""

import argparse
import json
import sys
from pathlib import Path

from evolve_common import add_workspace_args, load_workspace, PLUGIN_ROOT

sys.path.insert(0, str(PLUGIN_ROOT))
from lib.evolution_csv import EvolutionCSV


def _emit(obj):
    print(json.dumps(obj))


# AIDEV-NOTE: Cross-evolution wins. Siblings = other workspaces under the same
# root dir (default: parent of this evolution_dir, mirroring the greenhouse
# "Roots" control). We rank them by cheap BRIEF token-overlap and hand the top
# few — with their leading performers — to the ideator as UNTRUSTED context, so
# a technique that won in one workspace can cross-pollinate into a sibling. The
# overlap score is only a sort key; the (smart) ideator judges real relevance.
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
    "are", "be", "this", "that", "it", "as", "by", "at", "from", "we", "our",
    "you", "your", "i", "but", "not", "can", "will", "should", "must", "each",
    "all", "any", "no", "so", "if", "then", "than", "into", "over", "per",
}


def _brief_tokens(text: str) -> set:
    out = set()
    word = []
    for ch in text.lower():
        if ch.isalnum():
            word.append(ch)
        else:
            if word:
                w = "".join(word)
                if len(w) > 2 and w not in _STOP:
                    out.add(w)
                word = []
    if word:
        w = "".join(word)
        if len(w) > 2 and w not in _STOP:
            out.add(w)
    return out


def _brief_summary(text: str, limit: int = 240) -> str:
    """First meaningful line(s) of a BRIEF, headings stripped, capped."""
    parts = []
    used = 0
    for raw in text.splitlines():
        line = raw.lstrip("#").strip()
        if not line:
            continue
        parts.append(line)
        used += len(line)
        if used >= limit:
            break
    summary = " — ".join(parts)
    return summary[:limit].rstrip() + ("…" if len(summary) > limit else "")


def gather_sibling_wins(ws, root, max_siblings=5, per_sibling=2):
    """
    Discover sibling evolution workspaces under `root` and return their leading
    performers, ranked by BRIEF relevance to this workspace. Best-effort: any
    sibling that fails to load or has no completed performers is skipped (a note
    goes to stderr). Returns a JSON-ready list.
    """
    root = Path(root)
    if not root.is_dir():
        return []

    self_dir = ws.evolution_dir.resolve()
    my_tokens = _brief_tokens(ws.brief_path.read_text()) if ws.brief_path.exists() else set()

    # Each immediate subdir that carries its own config.yaml (directly or under
    # an evolution/ subdir) is a candidate sibling.
    candidates = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        cfg = None
        for probe in (child / "config.yaml", child / "evolution" / "config.yaml"):
            if probe.exists():
                cfg = probe
                break
        if cfg is None:
            continue
        try:
            sib = load_workspace(str(cfg.parent))
        except Exception as exc:  # noqa: BLE001 — best-effort discovery
            print(f"[siblings] skip {child.name}: {exc}", file=sys.stderr)
            continue
        if sib.evolution_dir.resolve() == self_dir:
            continue  # that's us
        candidates.append(sib)

    scored = []
    for sib in candidates:
        try:
            # Read-only and LOCK-FREE on purpose: a sibling may be mid-run with
            # its lock held by a worker. _read_csv just reads, and writes land
            # via atomic os.rename, so we see a complete old-or-new file, never a
            # torn one — and we never block the fleet or wait out the 10s lock.
            top = EvolutionCSV(str(sib.csv_path)).get_top_performers(per_sibling, include_novel=False)
        except Exception as exc:  # noqa: BLE001
            print(f"[siblings] skip {sib.evolution_dir.name}: {exc}", file=sys.stderr)
            continue
        if not top:
            continue  # no completed performers yet — nothing to cross-pollinate
        sib_brief = sib.brief_path.read_text() if sib.brief_path.exists() else ""
        sib_tokens = _brief_tokens(sib_brief)
        overlap = len(my_tokens & sib_tokens)
        denom = len(my_tokens | sib_tokens) or 1
        relevance = round(overlap / denom, 3)  # Jaccard
        scored.append({
            "workspace": sib.evolution_dir.name,
            "brief_summary": _brief_summary(sib_brief),
            "relevance": relevance,
            "wins": [
                {"id": w["id"], "performance": w["performance"], "description": w["description"]}
                for w in top
            ],
        })

    # Most-relevant first; ties broken by the sibling's best score.
    scored.sort(key=lambda s: (s["relevance"], max(w["performance"] for w in s["wins"])), reverse=True)
    return scored[:max_siblings]


def cmd_stats(csv, args):
    _emit(csv.get_csv_stats())


def cmd_ensure_baseline(csv, args):
    info = csv.get_candidate_info("baseline-000")
    if info:
        _emit({"added": False})
        return
    csv.append_candidates([{
        "id": "baseline-000",
        "basedOnId": "",
        "description": "Original algorithm.py performance",
        "status": "pending",
    }])
    _emit({"added": True})


def cmd_cleanup(csv, args):
    removed = csv.remove_duplicate_candidates()
    reset = csv.reset_stuck_candidates()
    fixed = csv.cleanup_corrupted_status_fields()
    _emit({"removed_duplicates": removed, "reset_stuck": reset, "fixed_status": fixed})


def cmd_claim_next(csv, args):
    result = csv.get_next_pending_candidate()  # atomically marks it 'running'
    if not result:
        _emit(None)
        return
    cand_id, _ = result
    info = csv.get_candidate_info(cand_id) or {}
    _emit({
        "id": cand_id,
        "basedOnId": info.get("basedOnId", ""),
        "description": info.get("description", ""),
    })


def cmd_info(csv, args):
    _emit(csv.get_candidate_info(args.id))


def cmd_set_status(csv, args):
    _emit({"ok": csv.update_candidate_status(args.id, args.status)})


def cmd_set_perf(csv, args):
    _emit({"ok": csv.update_candidate_performance(args.id, args.value)})


def cmd_set_field(csv, args):
    _emit({"ok": csv.update_candidate_field(args.id, args.col, args.value)})


def cmd_top_performers(csv, args):
    _emit(csv.get_top_performers(args.n))


def cmd_next_ids(csv, args):
    _emit(csv.get_next_ids(args.generation, args.count))


def cmd_append_ideas(csv, args):
    ideas = json.loads(args.json)
    if not isinstance(ideas, list):
        print("[ERROR] append-ideas expects a JSON list", file=sys.stderr)
        sys.exit(1)
    candidates = []
    for idea in ideas:
        candidates.append({
            "id": idea["id"],
            "basedOnId": idea.get("basedOnId", ""),
            "description": idea["description"],
            "status": "pending",
            "idea-LLM": idea.get("idea-LLM", "opus"),
        })
    added = csv.append_candidates(candidates)
    _emit({"added": added})


def cmd_params(ws):
    _emit({
        "evolution_dir": str(ws.evolution_dir),
        "csv_path": str(ws.csv_path),
        "max_workers": ws.max_workers,
        "worker_max_candidates": ws.worker_max_candidates,
        "auto_ideate": ws.auto_ideate,
        "min_completed_for_ideation": ws.min_completed_for_ideation,
        "total_ideas": ws.total_ideas,
    })


def cmd_context(csv, ws, args):
    top = csv.get_top_performers(args.n)
    existing = csv.get_all_descriptions()

    highest = csv.get_highest_generation()
    if highest > 0:
        gen_count = csv.get_generation_count(highest)
        generation = highest if gen_count < ws.total_ideas else highest + 1
    else:
        generation = 1

    brief = ""
    if ws.brief_path.exists():
        brief = ws.brief_path.read_text()

    notes = ""
    notes_path = ws.evolution_dir / "BRIEF-notes.md"
    if notes_path.exists():
        notes = notes_path.read_text()

    cross = []
    if not args.no_siblings:
        root = args.siblings_root or str(ws.evolution_dir.parent)
        cross = gather_sibling_wins(ws, root, max_siblings=args.sibling_count)

    _emit({
        "generation": generation,
        "evolution_dir": str(ws.evolution_dir),
        "top_performers": top,
        "brief": brief,
        "notes": notes,
        "existing_descriptions": existing,
        "cross_evolution_wins": cross,
        "num_elites": ws.num_elites,
        "total_ideas": ws.total_ideas,
        "strategies": ws.strategies,
    })


def main():
    parser = argparse.ArgumentParser(description="claude-evolve CSV interface")
    add_workspace_args(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("stats")
    sub.add_parser("params")
    sub.add_parser("ensure-baseline")
    sub.add_parser("cleanup")
    sub.add_parser("claim-next")

    p = sub.add_parser("info"); p.add_argument("id")
    p = sub.add_parser("set-status"); p.add_argument("id"); p.add_argument("status")
    p = sub.add_parser("set-perf"); p.add_argument("id"); p.add_argument("value")
    p = sub.add_parser("set-field"); p.add_argument("id"); p.add_argument("col"); p.add_argument("value")
    p = sub.add_parser("top-performers"); p.add_argument("--n", type=int, default=10)
    p = sub.add_parser("context"); p.add_argument("--n", type=int, default=3)
    p.add_argument("--siblings-root", help="Dir of sibling workspaces to mine for cross-evolution wins (default: parent of this workspace)")
    p.add_argument("--sibling-count", type=int, default=5, help="Max sibling workspaces to surface")
    p.add_argument("--no-siblings", action="store_true", help="Disable cross-evolution wins discovery")
    p = sub.add_parser("next-ids"); p.add_argument("generation", type=int); p.add_argument("count", type=int)
    p = sub.add_parser("append-ideas"); p.add_argument("json")

    args = parser.parse_args()
    ws = load_workspace(args.working_dir, args.config)

    if args.command == "params":
        cmd_params(ws)
        return

    with EvolutionCSV(str(ws.csv_path)) as csv:
        if args.command == "context":
            cmd_context(csv, ws, args)
            return
        handlers = {
            "stats": cmd_stats,
            "ensure-baseline": cmd_ensure_baseline,
            "cleanup": cmd_cleanup,
            "claim-next": cmd_claim_next,
            "info": cmd_info,
            "set-status": cmd_set_status,
            "set-perf": cmd_set_perf,
            "set-field": cmd_set_field,
            "top-performers": cmd_top_performers,
            "next-ids": cmd_next_ids,
            "append-ideas": cmd_append_ideas,
        }
        handlers[args.command](csv, args)


if __name__ == "__main__":
    main()
