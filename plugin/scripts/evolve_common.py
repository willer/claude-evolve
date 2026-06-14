#!/usr/bin/env python3
"""
Shared workspace resolution for claude-evolve plugin scripts.

AIDEV-NOTE: The plugin is fully self-contained — the CSV/sandbox engine lives in
../lib (stdlib-only) and this module does its own config resolution. No npm
package, no pip install, nothing outside the plugin dir is required at runtime.
Config resolution is deliberately simple: no global ~/.config merge, just the
workspace config.yaml.
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Make the engine importable as `lib.*` (it lives in this plugin, self-contained).
PLUGIN_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLUGIN_ROOT))

# AIDEV-NOTE: The plugin is deliberately stdlib-only so it runs with any Python
# the workspace happens to have, with no pip install. If PyYAML is present we
# use it; otherwise a minimal parser handles the simple config.yaml shape
# (flat scalars + one level of nesting, the only shape claude-evolve emits).
try:
    import yaml  # type: ignore

    def _parse_yaml(text: str) -> dict:
        return yaml.safe_load(text) or {}
except ImportError:
    def _coerce(val: str):
        v = val.strip()
        if (len(v) >= 2) and v[0] in "\"'" and v[-1] == v[0]:
            return v[1:-1]
        low = v.lower()
        if low in ("true", "yes"):
            return True
        if low in ("false", "no"):
            return False
        if low in ("null", "~", ""):
            return None
        try:
            return int(v)
        except ValueError:
            pass
        try:
            return float(v)
        except ValueError:
            pass
        return v

    def _parse_yaml(text: str) -> dict:
        """Minimal YAML-subset parser: top-level keys + 2-space nested maps."""
        root: dict = {}
        stack = [(-1, root)]  # (indent, container)
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].rstrip() if "#" in raw and not _in_quotes(raw) else raw.rstrip()
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip(" "))
            if ":" not in line:
                continue
            key, _, rest = line.lstrip().partition(":")
            key = key.strip()
            while stack and indent <= stack[-1][0]:
                stack.pop()
            parent = stack[-1][1]
            rest = rest.strip()
            if rest == "":
                child: dict = {}
                parent[key] = child
                stack.append((indent, child))
            else:
                parent[key] = _coerce(rest)
        return root

    def _in_quotes(line: str) -> bool:
        # Conservative: only strip comments when no quote precedes the '#'.
        idx = line.find("#")
        if idx == -1:
            return False
        prefix = line[:idx]
        return prefix.count('"') % 2 == 1 or prefix.count("'") % 2 == 1


@dataclass
class Workspace:
    """Resolved paths + settings for one evolution workspace."""
    config_path: Path
    evolution_dir: Path
    csv_path: Path
    algorithm_path: Path
    evaluator_path: Path
    brief_path: Path
    output_dir: Path
    python_cmd: str
    timeout_seconds: int
    sandbox_enabled: bool
    memory_limit_mb: int
    cpu_limit_seconds: int
    num_elites: int
    total_ideas: int
    strategies: dict
    max_workers: int
    worker_max_candidates: int
    auto_ideate: bool
    min_completed_for_ideation: int


def find_config(working_dir: str = None, config_path: str = None) -> Path:
    """
    Locate config.yaml. Resolution order:
      1. explicit --config
      2. <working_dir>/config.yaml  (and bare working_dir that IS a config.yaml)
      3. $CLAUDE_EVOLVE_CONFIG
      4. ./evolution/config.yaml
      5. ./config.yaml
    """
    if config_path:
        p = Path(config_path)
        if not p.exists():
            raise FileNotFoundError(f"Config not found: {p}")
        return p.resolve()

    if working_dir:
        wd = Path(working_dir)
        cand = wd if wd.name == "config.yaml" else wd / "config.yaml"
        if cand.exists():
            return cand.resolve()
        raise FileNotFoundError(f"Config not found in working dir: {cand}")

    env = os.environ.get("CLAUDE_EVOLVE_CONFIG")
    if env and Path(env).exists():
        return Path(env).resolve()

    for cand in (Path("evolution/config.yaml"), Path("config.yaml")):
        if cand.exists():
            return cand.resolve()

    raise FileNotFoundError(
        "No config.yaml found. Pass --working-dir, or run from a directory "
        "containing evolution/config.yaml or config.yaml."
    )


def load_workspace(working_dir: str = None, config_path: str = None) -> Workspace:
    """Load and resolve a workspace from its config.yaml."""
    cfg = find_config(working_dir, config_path)
    data = _parse_yaml(cfg.read_text())

    base = cfg.parent

    def resolve(rel: str) -> Path:
        p = Path(rel)
        return (p if p.is_absolute() else base / p).resolve()

    out_dir_rel = data.get("output_dir", "") or ""
    output_dir = base.resolve() if not out_dir_rel else resolve(out_dir_rel)

    sandbox = data.get("sandbox", {}) or {}
    ideation = data.get("ideation_strategies", data.get("ideation", {})) or {}
    parallel = data.get("parallel", {}) or {}

    return Workspace(
        config_path=cfg,
        evolution_dir=base.resolve(),
        csv_path=resolve(data.get("csv_file", data.get("evolution_csv", "evolution.csv"))),
        algorithm_path=resolve(data.get("algorithm_file", "algorithm.py")),
        evaluator_path=resolve(data.get("evaluator_file", "evaluator.py")),
        brief_path=resolve(data.get("brief_file", "BRIEF.md")),
        output_dir=output_dir,
        python_cmd=data.get("python_cmd", "python3"),
        timeout_seconds=int(data.get("timeout_seconds", 600)),
        sandbox_enabled=bool(sandbox.get("enabled", True)),
        memory_limit_mb=int(sandbox.get("memory_limit_mb", data.get("memory_limit_mb", 0))),
        cpu_limit_seconds=int(sandbox.get("cpu_limit_seconds", 0)),
        num_elites=int(ideation.get("num_elites", 3)),
        total_ideas=int(ideation.get("total_ideas", 15)),
        strategies={
            "novel_exploration": int(ideation.get("novel_exploration", 3)),
            "hill_climbing": int(ideation.get("hill_climbing", 5)),
            "structural_mutation": int(ideation.get("structural_mutation", 3)),
            "crossover_hybrid": int(ideation.get("crossover_hybrid", 4)),
        },
        max_workers=int(parallel.get("max_workers", 4)),
        worker_max_candidates=int(data.get("worker_max_candidates", 3)),
        auto_ideate=bool(data.get("auto_ideate", True)),
        min_completed_for_ideation=int(data.get("min_completed_for_ideation", 3)),
    )


def add_workspace_args(parser):
    """Add the standard --working-dir / --config options to an argparse parser."""
    parser.add_argument("--working-dir", help="Path to the evolution workspace (dir containing config.yaml)")
    parser.add_argument("--config", help="Explicit path to config.yaml")
