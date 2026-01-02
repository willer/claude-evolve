#!/usr/bin/env python3
"""
Ideation module for claude-evolve.
Generates new algorithm ideas using various strategies.

AIDEV-NOTE: This is the Python port of bin/claude-evolve-ideate.
Includes novelty filtering to prevent near-duplicate ideas.
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Tuple

# Add lib to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from lib.evolution_csv import EvolutionCSV
from lib.ai_cli import call_ai_with_backoff, get_git_protection_warning, AIError
from lib.embedding import check_novelty as check_embedding_novelty, get_embedding, set_cache_file, save_cache


@dataclass
class IdeationConfig:
    """Configuration for ideation."""
    csv_path: str
    evolution_dir: str
    brief_path: str
    algorithm_path: str

    # Strategy counts
    total_ideas: int = 15
    novel_exploration: int = 3
    hill_climbing: int = 5
    structural_mutation: int = 3
    crossover_hybrid: int = 4
    num_elites: int = 3

    # Novelty filtering
    novelty_enabled: bool = True
    novelty_threshold: float = 0.92

    # Retry configuration with exponential backoff
    # AIDEV-NOTE: This implements round-based retries like the shell version.
    # Each round tries ALL models. If all fail, wait and retry.
    max_rounds: int = 10          # Max full rounds of all models
    initial_wait: int = 60        # Seconds to wait after first failed round
    max_wait: int = 600           # Max wait between rounds (10 minutes)


@dataclass
class Idea:
    """A generated idea."""
    id: str
    based_on_id: str
    description: str
    strategy: str


@dataclass
class IdeationContext:
    """Context for ideation strategies."""
    generation: int
    top_performers: List[Dict]
    brief_content: str
    existing_descriptions: List[str]
    config: IdeationConfig


class IdeationStrategy(ABC):
    """Base class for ideation strategies."""

    def __init__(self, config: IdeationConfig, csv: EvolutionCSV):
        self.config = config
        self.csv = csv

    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name."""
        pass

    @abstractmethod
    def build_prompt(self, context: IdeationContext, ids: List[str], temp_csv_basename: str) -> str:
        """Build the AI prompt."""
        pass

    def generate(self, context: IdeationContext, count: int,
                 max_rounds: int = 10, initial_wait: int = 60, max_wait: int = 600,
                 claimed_ids: List[str] = None) -> List[Idea]:
        """Generate ideas using this strategy with round-based retry and backoff.

        AIDEV-NOTE: Uses call_ai_with_backoff for robust retry handling.
        Each round tries ALL models. If all fail, waits with exponential backoff.
        claimed_ids tracks IDs already claimed by previous strategies in this run.
        IDs are added to claimed_ids immediately to prevent reuse even on failure.
        """
        if count <= 0:
            return []
        if claimed_ids is None:
            claimed_ids = []

        print(f"[IDEATE] Running {self.name} strategy for {count} ideas", file=sys.stderr, flush=True)

        # Get next IDs, avoiding any already claimed in this ideation run
        ids = self.csv.get_next_ids(context.generation, count, claimed_ids=claimed_ids)
        print(f"[IDEATE] Using IDs: {', '.join(ids)}", file=sys.stderr, flush=True)

        # Immediately claim these IDs (even if AI fails, don't reuse them)
        claimed_ids.extend(ids)

        # Create temp CSV with stub rows
        temp_csv = Path(self.config.evolution_dir) / f"temp-csv-{os.getpid()}.csv"
        shutil.copy(self.config.csv_path, temp_csv)

        # Add stub rows
        with open(temp_csv, 'a') as f:
            for id in ids:
                parent = self._get_default_parent(context)
                f.write(f'{id},{parent},"[PLACEHOLDER: Replace with algorithmic idea]",,pending\n')

        try:
            # Build prompt
            prompt = self.build_prompt(context, ids, temp_csv.name)

            # Call AI with round-based retry and backoff
            output, model = call_ai_with_backoff(
                prompt,
                command="ideate",
                working_dir=self.config.evolution_dir,
                max_rounds=max_rounds,
                initial_wait=initial_wait,
                max_wait=max_wait
            )

            # Parse results from modified CSV
            ideas = self._parse_results(temp_csv, ids)

            if ideas:
                # Record model used
                for idea in ideas:
                    idea.strategy = f"{self.name} ({model})"
                return ideas
            else:
                print(f"[IDEATE] AI completed but no ideas parsed from output", file=sys.stderr)
                return []

        except AIError as e:
            print(f"[IDEATE] All retries exhausted in {self.name}: {e}", file=sys.stderr)
            return []

        finally:
            temp_csv.unlink(missing_ok=True)

    def _get_default_parent(self, context: IdeationContext) -> str:
        """Get default parent ID for this strategy."""
        if context.top_performers:
            return context.top_performers[0]['id']
        return ""

    def _parse_results(self, temp_csv: Path, expected_ids: List[str]) -> List[Idea]:
        """Parse ideas from modified CSV."""
        ideas = []

        with open(temp_csv) as f:
            import csv
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 3:
                    id = row[0].strip().strip('"')
                    if id in expected_ids:
                        based_on = row[1].strip() if len(row) > 1 else ""
                        description = row[2].strip().strip('"')
                        # Skip if still placeholder
                        if "PLACEHOLDER" not in description and description:
                            ideas.append(Idea(
                                id=id,
                                based_on_id=based_on,
                                description=description,
                                strategy=self.name
                            ))

        return ideas


class NovelExplorationStrategy(IdeationStrategy):
    """Generate novel, creative ideas not based on existing algorithms."""

    @property
    def name(self) -> str:
        return "novel_exploration"

    def _get_default_parent(self, context: IdeationContext) -> str:
        return ""  # Novel ideas have no parent

    def build_prompt(self, context: IdeationContext, ids: List[str], temp_csv_basename: str) -> str:
        return f"""{get_git_protection_warning()}

I need you to use your file editing capabilities to fill in PLACEHOLDER descriptions in the CSV file: {temp_csv_basename}

Current evolution context:
- Generation: {context.generation}
- Brief: {context.brief_content[:500]}

CRITICAL TASK:
The CSV file already contains stub rows with these IDs: {', '.join(ids)}
Each stub row has a PLACEHOLDER description.
Your job is to REPLACE each PLACEHOLDER with a real algorithmic idea description.

IMPORTANT FILE READING INSTRUCTIONS:
Read ONLY the last 20-30 lines of the CSV file to see the placeholder rows.
DO NOT read the entire file - use offset and limit parameters.

CRITICAL INSTRUCTIONS:
1. Read ONLY the last 20-30 lines of the CSV to see the placeholder rows
2. DO NOT ADD OR DELETE ANY ROWS - only EDIT the placeholder descriptions
3. DO NOT CHANGE THE IDs - they are already correct
4. Use the Edit tool to replace EACH PLACEHOLDER text with a real algorithmic idea
5. ALWAYS wrap the description field in double quotes
6. Each description should be one clear sentence describing a novel algorithmic approach
7. Focus on creative, ambitious ideas that haven't been tried yet

IMPORTANT: Use your file editing tools (Edit/MultiEdit) to modify the CSV file directly."""


class HillClimbingStrategy(IdeationStrategy):
    """Generate incremental improvements to top performers."""

    @property
    def name(self) -> str:
        return "hill_climbing"

    def build_prompt(self, context: IdeationContext, ids: List[str], temp_csv_basename: str) -> str:
        top_str = "\n".join(
            f"  {p['id']}: {p['description'][:100]}... (score: {p['performance']})"
            for p in context.top_performers[:5]
        )
        valid_parents = ",".join(p['id'] for p in context.top_performers[:5])

        return f"""{get_git_protection_warning()}

I need you to use your file editing capabilities to fill in PLACEHOLDER descriptions in the CSV file: {temp_csv_basename}

IMPORTANT: You MUST use one of these exact parent IDs: {valid_parents}

Successful algorithms to tune:
{top_str}

CRITICAL TASK:
The CSV file already contains stub rows with these IDs: {', '.join(ids)}
Your job is to REPLACE each PLACEHOLDER with a parameter tuning idea.

INSTRUCTIONS:
1. Read ONLY the last 20-30 lines of the CSV file
2. Each idea should be a small parameter adjustment or optimization
3. Reference which parent you're improving and what specifically you're changing
4. DO NOT ADD OR DELETE ANY ROWS - only EDIT the placeholder descriptions
5. ALWAYS wrap descriptions in double quotes
6. Use the Edit tool to modify the file directly"""


class StructuralMutationStrategy(IdeationStrategy):
    """Generate structural changes to algorithms."""

    @property
    def name(self) -> str:
        return "structural_mutation"

    def build_prompt(self, context: IdeationContext, ids: List[str], temp_csv_basename: str) -> str:
        top_str = "\n".join(
            f"  {p['id']}: {p['description'][:100]}..."
            for p in context.top_performers[:5]
        )
        valid_parents = ",".join(p['id'] for p in context.top_performers[:5])

        return f"""{get_git_protection_warning()}

I need you to use your file editing capabilities to fill in PLACEHOLDER descriptions in the CSV file: {temp_csv_basename}

IMPORTANT: You MUST use one of these exact parent IDs: {valid_parents}

Top algorithms for structural changes:
{top_str}

CRITICAL TASK:
The CSV file already contains stub rows with these IDs: {', '.join(ids)}
Your job is to REPLACE each PLACEHOLDER with a structural mutation idea.

INSTRUCTIONS:
1. Read ONLY the last 20-30 lines of the CSV file
2. Each idea should involve a significant architectural change
3. Examples: adding new features, changing data flow, combining techniques
4. DO NOT ADD OR DELETE ANY ROWS - only EDIT the placeholder descriptions
5. ALWAYS wrap descriptions in double quotes
6. Use the Edit tool to modify the file directly"""


class CrossoverStrategy(IdeationStrategy):
    """Generate crossover ideas combining multiple algorithms."""

    @property
    def name(self) -> str:
        return "crossover"

    def build_prompt(self, context: IdeationContext, ids: List[str], temp_csv_basename: str) -> str:
        top_str = "\n".join(
            f"  {p['id']}: {p['description'][:100]}..."
            for p in context.top_performers[:5]
        )
        valid_parents = ",".join(p['id'] for p in context.top_performers[:5])

        return f"""{get_git_protection_warning()}

I need you to use your file editing capabilities to fill in PLACEHOLDER descriptions in the CSV file: {temp_csv_basename}

IMPORTANT: Reference multiple parents from: {valid_parents}

Top algorithms to combine:
{top_str}

CRITICAL TASK:
The CSV file already contains stub rows with these IDs: {', '.join(ids)}
Your job is to REPLACE each PLACEHOLDER with a crossover idea.

INSTRUCTIONS:
1. Read ONLY the last 20-30 lines of the CSV file
2. Each idea should combine elements from 2+ top algorithms
3. In parent_id, list the main parent (use comma-separated for multiple)
4. Describe how you're combining the approaches
5. DO NOT ADD OR DELETE ANY ROWS - only EDIT the placeholder descriptions
6. ALWAYS wrap descriptions in double quotes
7. Use the Edit tool to modify the file directly"""


class Ideator:
    """Main ideation controller."""

    def __init__(self, config: IdeationConfig):
        self.config = config
        self.csv = EvolutionCSV(config.csv_path)

        # Initialize embedding cache for novelty filtering
        if config.novelty_enabled:
            cache_path = Path(config.evolution_dir) / "embeddings_cache.json"
            set_cache_file(str(cache_path))
            print(f"[IDEATE] Embedding cache: {cache_path}", file=sys.stderr)

        # Initialize strategies
        self.strategies = [
            (NovelExplorationStrategy(config, self.csv), config.novel_exploration),
            (HillClimbingStrategy(config, self.csv), config.hill_climbing),
            (StructuralMutationStrategy(config, self.csv), config.structural_mutation),
            (CrossoverStrategy(config, self.csv), config.crossover_hybrid),
        ]

    def get_context(self) -> IdeationContext:
        """Build ideation context."""
        with EvolutionCSV(self.config.csv_path) as csv:
            top_performers = csv.get_top_performers(self.config.num_elites)
            existing_descriptions = csv.get_all_descriptions()
            generation = csv.get_highest_generation() + 1

        # Read brief
        brief_content = ""
        if Path(self.config.brief_path).exists():
            brief_content = Path(self.config.brief_path).read_text()[:1000]

        return IdeationContext(
            generation=generation,
            top_performers=top_performers,
            brief_content=brief_content,
            existing_descriptions=existing_descriptions,
            config=self.config
        )

    def check_novelty(self, description: str, existing: List[str]) -> Tuple[bool, float]:
        """Check if description is novel enough."""
        if not self.config.novelty_enabled:
            return True, 0.0

        if not existing:
            return True, 0.0

        try:
            is_novel, max_sim = check_embedding_novelty(
                description,
                existing,
                threshold=self.config.novelty_threshold
            )
            return is_novel, max_sim
        except Exception as e:
            print(f"[IDEATE] Novelty check failed: {e}", file=sys.stderr)
            return True, 0.0  # Allow if check fails

    def run(self) -> int:
        """Run ideation. Returns number of ideas generated."""
        context = self.get_context()
        print(f"[IDEATE] Starting generation {context.generation}", file=sys.stderr)
        print(f"[IDEATE] Top performers: {len(context.top_performers)}", file=sys.stderr)

        all_ideas: List[Idea] = []
        claimed_ids: List[str] = []  # Track IDs claimed across all strategies
        strategies_succeeded = 0

        for strategy, count in self.strategies:
            if count <= 0:
                continue

            ideas = strategy.generate(
                context, count,
                max_rounds=self.config.max_rounds,
                initial_wait=self.config.initial_wait,
                max_wait=self.config.max_wait,
                claimed_ids=claimed_ids  # Pass already-claimed IDs
            )

            if ideas:
                # IDs are already tracked in generate(), just count success
                strategies_succeeded += 1

                # Filter for novelty
                novel_ideas = []
                for idea in ideas:
                    is_novel, similarity = self.check_novelty(
                        idea.description,
                        context.existing_descriptions + [i.description for i in all_ideas]
                    )

                    if is_novel:
                        novel_ideas.append(idea)
                        print(f"[IDEATE] Accepted: {idea.id} (sim={similarity:.2%})", file=sys.stderr)
                    else:
                        print(f"[IDEATE] Rejected (too similar {similarity:.2%}): {idea.description[:50]}...", file=sys.stderr)

                all_ideas.extend(novel_ideas)

        # Add ideas to CSV
        if all_ideas:
            with EvolutionCSV(self.config.csv_path) as csv:
                candidates = [
                    {
                        'id': idea.id,
                        'basedOnId': idea.based_on_id,
                        'description': idea.description,
                        'status': 'pending',
                        'idea-LLM': idea.strategy
                    }
                    for idea in all_ideas
                ]
                added = csv.append_candidates(candidates)
                print(f"[IDEATE] Added {added} ideas to CSV", file=sys.stderr)

        print(f"[IDEATE] Strategies succeeded: {strategies_succeeded}/{len([s for s, c in self.strategies if c > 0])}", file=sys.stderr)
        print(f"[IDEATE] Total ideas generated: {len(all_ideas)}", file=sys.stderr)

        # Final cache save
        if self.config.novelty_enabled:
            save_cache()

        return len(all_ideas)


def load_config(config_path: Optional[str] = None) -> IdeationConfig:
    """Load configuration from YAML."""
    import yaml

    # Find config
    if config_path:
        yaml_path = Path(config_path)
    elif os.environ.get('CLAUDE_EVOLVE_CONFIG'):
        yaml_path = Path(os.environ['CLAUDE_EVOLVE_CONFIG'])
    else:
        yaml_path = Path('evolution/config.yaml')
        if not yaml_path.exists():
            yaml_path = Path('config.yaml')

    if not yaml_path.exists():
        raise FileNotFoundError(f"Config not found: {yaml_path}")

    with open(yaml_path) as f:
        data = yaml.safe_load(f) or {}

    base_dir = yaml_path.parent

    def resolve(path: str) -> str:
        p = Path(path)
        if not p.is_absolute():
            p = base_dir / p
        return str(p.resolve())

    ideation = data.get('ideation', {})
    novelty = data.get('novelty', {})

    return IdeationConfig(
        csv_path=resolve(data.get('csv_file', 'evolution.csv')),
        evolution_dir=str(base_dir.resolve()),
        brief_path=resolve(data.get('brief_file', 'BRIEF.md')),
        algorithm_path=resolve(data.get('algorithm_file', 'algorithm.py')),
        total_ideas=ideation.get('total_ideas', 15),
        novel_exploration=ideation.get('novel_exploration', 3),
        hill_climbing=ideation.get('hill_climbing', 5),
        structural_mutation=ideation.get('structural_mutation', 3),
        crossover_hybrid=ideation.get('crossover_hybrid', 4),
        num_elites=ideation.get('num_elites', 3),
        novelty_enabled=novelty.get('enabled', True),
        novelty_threshold=novelty.get('threshold', 0.92),
        max_rounds=ideation.get('max_rounds', 10),
        initial_wait=ideation.get('initial_wait', 60),
        max_wait=ideation.get('max_wait', 600)
    )


def main():
    parser = argparse.ArgumentParser(description='Claude Evolve Ideation')
    parser.add_argument('--config', help='Path to config.yaml')
    parser.add_argument('--count', type=int, help='Override total idea count')
    args = parser.parse_args()

    try:
        config = load_config(args.config)

        ideator = Ideator(config)
        count = ideator.run()

        if count > 0:
            print(f"Generated {count} ideas", file=sys.stderr)
            sys.exit(0)
        else:
            print("No ideas generated", file=sys.stderr)
            sys.exit(1)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
