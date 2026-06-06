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
                                 brief, notes, existing descriptions)
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

    _emit({
        "generation": generation,
        "evolution_dir": str(ws.evolution_dir),
        "top_performers": top,
        "brief": brief,
        "notes": notes,
        "existing_descriptions": existing,
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
