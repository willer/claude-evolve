#!/usr/bin/env python3
"""
Meta-learning module for claude-evolve.

AIDEV-NOTE: This module generates and maintains BRIEF-notes.md, which accumulates
learnings from completed generations. These notes help guide future ideation
by documenting what approaches worked and what didn't.

The process:
1. After a generation completes, analyze which algorithms improved performance
2. Summarize the successful and unsuccessful approaches
3. Append learnings to BRIEF-notes.md
4. Ideation phase reads both BRIEF.md and BRIEF-notes.md

This is a simpler approach than full meta-summarization - just accumulating
notes about what works.
"""

import os
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from lib.evolution_csv import EvolutionCSV
from lib.ai_cli import call_ai_with_backoff, AIError
from lib.log import log, log_error, log_warn


@dataclass
class GenerationSummary:
    """Summary of a completed generation."""
    generation: int
    total_algorithms: int
    successful: int  # Improved over parent
    failed: int  # Worse than parent or failed
    best_improvement: float
    best_id: str
    best_description: str
    worst_improvement: float
    worst_id: str
    algorithms: List[Dict]  # Full list of algorithms with scores


def analyze_generation(csv_path: str, generation: int) -> Optional[GenerationSummary]:
    """
    Analyze a completed generation's results.

    Args:
        csv_path: Path to evolution.csv
        generation: Generation number to analyze

    Returns:
        GenerationSummary or None if generation not complete
    """
    gen_prefix = f"gen{generation:02d}-"

    with EvolutionCSV(csv_path) as csv:
        rows = csv._read_csv()

    if not rows:
        return None

    has_header = rows and rows[0] and rows[0][0].lower() == 'id'
    start_idx = 1 if has_header else 0

    algorithms = []
    pending_count = 0

    for row in rows[start_idx:]:
        if len(row) < 5:
            continue

        candidate_id = row[0].strip().strip('"')
        if not candidate_id.startswith(gen_prefix):
            continue

        status = row[4].strip().lower() if row[4] else ''

        # Skip if still pending
        if status in ('pending', 'running', ''):
            pending_count += 1
            continue

        if status != 'complete':
            continue

        performance_str = row[3].strip() if len(row) > 3 else ''
        try:
            performance = float(performance_str)
        except ValueError:
            continue

        parent_id = row[1].strip() if len(row) > 1 else ''
        description = row[2].strip() if len(row) > 2 else ''

        # Get parent's score
        parent_score = 0.0
        if parent_id:
            with EvolutionCSV(csv_path) as csv:
                parent_info = csv.get_candidate_info(parent_id)
                if parent_info and parent_info.get('performance'):
                    try:
                        parent_score = float(parent_info['performance'])
                    except ValueError:
                        pass

        improvement = performance - parent_score

        algorithms.append({
            'id': candidate_id,
            'description': description,
            'performance': performance,
            'parent_id': parent_id,
            'parent_score': parent_score,
            'improvement': improvement
        })

    if not algorithms:
        if pending_count > 0:
            log(f"Generation {generation} still has {pending_count} pending algorithms")
        return None

    # Sort by improvement
    algorithms.sort(key=lambda x: x['improvement'], reverse=True)

    successful = len([a for a in algorithms if a['improvement'] > 0])
    failed = len(algorithms) - successful

    best = algorithms[0]
    worst = algorithms[-1]

    return GenerationSummary(
        generation=generation,
        total_algorithms=len(algorithms),
        successful=successful,
        failed=failed,
        best_improvement=best['improvement'],
        best_id=best['id'],
        best_description=best['description'],
        worst_improvement=worst['improvement'],
        worst_id=worst['id'],
        algorithms=algorithms
    )


def generate_notes(
    summary: GenerationSummary,
    brief_content: str,
    evolution_dir: str
) -> Optional[str]:
    """
    Generate notes using AI analysis.

    Args:
        summary: Generation summary data
        brief_content: Content of BRIEF.md for context
        evolution_dir: Directory for AI working dir

    Returns:
        Generated notes text or None on failure
    """
    # Build algorithm summary for prompt
    algo_summaries = []
    for algo in summary.algorithms[:10]:  # Top 10 only to limit context
        status = "improved" if algo['improvement'] > 0 else "regressed"
        algo_summaries.append(
            f"- {algo['id']}: {algo['description'][:100]}... "
            f"(improvement: {algo['improvement']:+.4f}, {status})"
        )

    prompt = f"""Analyze the results of generation {summary.generation} and provide brief learnings.

## Problem Context (from BRIEF.md)
{brief_content[:1000]}

## Generation {summary.generation} Results
- Total algorithms: {summary.total_algorithms}
- Improved over parent: {summary.successful}
- Regressed from parent: {summary.failed}
- Best improvement: {summary.best_improvement:+.4f} ({summary.best_id})
- Worst: {summary.worst_improvement:+.4f} ({summary.worst_id})

## Algorithm Details
{chr(10).join(algo_summaries)}

## Your Task
Write 2-4 bullet points summarizing:
1. What approaches WORKED (led to improvement)
2. What approaches FAILED (led to regression)
3. Any patterns you notice

Be specific about the algorithmic techniques, not just generic observations.
Format your response as markdown bullet points starting with "- ".
Keep it concise - this will be appended to accumulated notes.
"""

    try:
        output, model = call_ai_with_backoff(
            prompt,
            command="ideate",  # Use ideation model pool
            working_dir=evolution_dir,
            max_rounds=3,
            initial_wait=30,
            max_wait=120
        )

        # Extract bullet points from output
        notes = []
        for line in output.strip().split('\n'):
            line = line.strip()
            if line.startswith('- ') or line.startswith('* '):
                notes.append(line)

        if notes:
            return '\n'.join(notes)

        # If no bullet points found, return the whole output (trimmed)
        return output.strip()[:500]

    except AIError as e:
        log_error(f"Failed to generate notes: {e}")
        return None


def update_brief_notes(
    evolution_dir: str,
    generation: int,
    notes: str
) -> bool:
    """
    Append notes to BRIEF-notes.md.

    Args:
        evolution_dir: Evolution directory path
        generation: Generation number
        notes: Notes to append

    Returns:
        True if successful
    """
    notes_path = Path(evolution_dir) / "BRIEF-notes.md"

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = f"\n## Generation {generation} ({timestamp})\n\n"

    try:
        # Read existing content
        existing = ""
        if notes_path.exists():
            existing = notes_path.read_text()

        # Ensure header exists
        if not existing.strip():
            existing = "# Evolution Notes\n\nAccumulated learnings from evolution generations.\n"

        # Append new notes
        with open(notes_path, 'w') as f:
            f.write(existing.rstrip() + "\n" + header + notes + "\n")

        log(f"Updated BRIEF-notes.md with generation {generation} learnings")
        return True

    except Exception as e:
        log_error(f"Failed to update BRIEF-notes.md: {e}")
        return False


def process_generation(
    csv_path: str,
    evolution_dir: str,
    generation: int,
    brief_path: str
) -> bool:
    """
    Process a completed generation and update notes.

    Args:
        csv_path: Path to evolution.csv
        evolution_dir: Evolution directory
        generation: Generation number to process
        brief_path: Path to BRIEF.md

    Returns:
        True if notes were updated
    """
    log(f"Analyzing generation {generation}...")

    # Analyze generation
    summary = analyze_generation(csv_path, generation)
    if not summary:
        log(f"Generation {generation} not complete or no data")
        return False

    log(f"Generation {generation}: {summary.successful}/{summary.total_algorithms} improved")

    # Read brief for context
    brief_content = ""
    if Path(brief_path).exists():
        brief_content = Path(brief_path).read_text()[:2000]

    # Generate notes
    notes = generate_notes(summary, brief_content, evolution_dir)
    if not notes:
        # Fallback to simple summary without AI
        notes = f"""- Best performer: {summary.best_id} with improvement {summary.best_improvement:+.4f}
- Success rate: {summary.successful}/{summary.total_algorithms} algorithms improved
- Top approach: {summary.best_description[:100]}"""

    # Update notes file
    return update_brief_notes(evolution_dir, generation, notes)


def get_last_processed_generation(evolution_dir: str) -> int:
    """
    Get the last generation that has notes in BRIEF-notes.md.

    Returns:
        Last processed generation number, or 0 if none
    """
    notes_path = Path(evolution_dir) / "BRIEF-notes.md"
    if not notes_path.exists():
        return 0

    try:
        content = notes_path.read_text()
        import re

        # Find all "## Generation N" headers
        matches = re.findall(r'## Generation (\d+)', content)
        if matches:
            return max(int(m) for m in matches)

    except Exception:
        pass

    return 0


def process_new_generations(
    csv_path: str,
    evolution_dir: str,
    brief_path: str
) -> int:
    """
    Process any generations that don't have notes yet.

    Returns:
        Number of generations processed
    """
    # Get current highest generation in CSV
    with EvolutionCSV(csv_path) as csv:
        highest_gen = csv.get_highest_generation()

    # Get last processed generation
    last_processed = get_last_processed_generation(evolution_dir)

    processed = 0
    for gen in range(last_processed + 1, highest_gen + 1):
        if process_generation(csv_path, evolution_dir, gen, brief_path):
            processed += 1

    return processed


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Process generation learnings')
    parser.add_argument('--config', help='Path to config.yaml')
    parser.add_argument('--generation', type=int, help='Specific generation to process')
    args = parser.parse_args()

    # Load config
    import yaml

    if args.config:
        config_path = Path(args.config)
    elif os.environ.get('CLAUDE_EVOLVE_CONFIG'):
        config_path = Path(os.environ['CLAUDE_EVOLVE_CONFIG'])
    else:
        config_path = Path('evolution/config.yaml')
        if not config_path.exists():
            config_path = Path('config.yaml')

    if not config_path.exists():
        print(f"Config not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        data = yaml.safe_load(f) or {}

    base_dir = config_path.parent

    def resolve(path: str) -> str:
        p = Path(path)
        if not p.is_absolute():
            p = base_dir / p
        return str(p.resolve())

    csv_path = resolve(data.get('csv_file', 'evolution.csv'))
    evolution_dir = str(base_dir.resolve())
    brief_path = resolve(data.get('brief_file', 'BRIEF.md'))

    if args.generation:
        success = process_generation(csv_path, evolution_dir, args.generation, brief_path)
        sys.exit(0 if success else 1)
    else:
        processed = process_new_generations(csv_path, evolution_dir, brief_path)
        print(f"Processed {processed} generation(s)")
