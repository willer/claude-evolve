#!/usr/bin/env python3
"""
Prepare a candidate file for the coding agent.

Resolves the candidate's parent, copies the parent algorithm to
evolution_<id>.py, and prints JSON describing what the coding agent must edit.
This is the deterministic prelude to evolve-code; the AI never has to figure
out parent resolution or file copying.

Output JSON:
  {
    "id": "...",
    "is_baseline": false,
    "description": "...",          # what the coding agent should implement
    "parent": "gen01-002",         # resolved parent id (or null)
    "target_path": "/abs/evolution_gen02-001.py",
    "target_basename": "evolution_gen02-001.py",
    "already_exists": false        # true if target file already present (skip coding)
  }

Exit codes:
  0  ok
  2  parent could not be resolved (missing parent file)
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from evolve_common import add_workspace_args, load_workspace, PLUGIN_ROOT

sys.path.insert(0, str(PLUGIN_ROOT))
from lib.evolution_csv import EvolutionCSV

BASELINE_IDS = {"baseline", "baseline-000", "000", "0", "gen00-000"}


def is_baseline(candidate_id: str, parent_id: str) -> bool:
    return not parent_id and candidate_id in BASELINE_IDS


def resolve_parent(parent_id: str, ws, output_dir: Path):
    """Return (resolved_id, source_path) or (None, None) if unresolvable."""
    if not parent_id or parent_id == "baseline-000":
        return None, ws.algorithm_path
    for cand in re.split(r"[,;\s]+", parent_id):
        cand = cand.strip()
        if not cand:
            continue
        f = output_dir / f"evolution_{cand}.py"
        if f.exists():
            return cand, f
    return None, None


def main():
    parser = argparse.ArgumentParser(description="Prepare a candidate for coding")
    add_workspace_args(parser)
    parser.add_argument("id")
    args = parser.parse_args()

    ws = load_workspace(args.working_dir, args.config)
    output_dir = ws.output_dir

    with EvolutionCSV(str(ws.csv_path)) as csv:
        info = csv.get_candidate_info(args.id)
    if not info:
        print(f"[ERROR] Candidate not found in CSV: {args.id}", file=sys.stderr)
        sys.exit(1)

    parent_id = info.get("basedOnId", "") or ""
    description = info.get("description", "") or ""
    baseline = is_baseline(args.id, parent_id)

    if baseline:
        print(json.dumps({
            "id": args.id,
            "is_baseline": True,
            "description": description,
            "parent": None,
            "target_path": str(ws.algorithm_path),
            "target_basename": ws.algorithm_path.name,
            "already_exists": True,
        }))
        return

    resolved_parent, source = resolve_parent(parent_id, ws, output_dir)
    if source is None:
        print(f"[ERROR] Parent not found for {args.id}: basedOnId={parent_id!r}", file=sys.stderr)
        sys.exit(2)

    target = output_dir / f"evolution_{args.id}.py"
    already = target.exists()
    if not already:
        shutil.copy(source, target)

    print(json.dumps({
        "id": args.id,
        "is_baseline": False,
        "description": description,
        "parent": resolved_parent,
        "target_path": str(target),
        "target_basename": target.name,
        "already_exists": already,
    }))


if __name__ == "__main__":
    main()
