#!/usr/bin/env python3
"""
UCB-based Multi-Armed Bandit for LLM model selection.

AIDEV-NOTE: This module tracks which LLM models produce the best algorithm
improvements and uses UCB1 to select models, balancing exploitation
(using models that historically perform well) with exploration
(trying models that haven't been used much).

The key insight is: we track the IMPROVEMENT each model produces,
not the absolute score. improvement = child_score - parent_score.
This normalizes across different problem difficulties.
"""

import json
import math
import os
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class ModelStats:
    """Statistics for a single model."""
    name: str
    n_completed: int = 0  # Times this model completed successfully
    n_submitted: int = 0  # Times this model was selected
    total_improvement: float = 0.0  # Sum of (child_score - parent_score)

    @property
    def mean_improvement(self) -> float:
        """Average improvement per completion."""
        if self.n_completed == 0:
            return 0.0
        return self.total_improvement / self.n_completed


class LLMBandit:
    """
    UCB1-based bandit for LLM model selection.

    Tracks which models produce the best improvements and selects
    models using Upper Confidence Bound algorithm.

    Formula: UCB = mean_improvement + c * sqrt(ln(N) / n_i)

    Where:
    - mean_improvement: average (child_score - parent_score) for this model
    - c: exploration coefficient (default 1.0)
    - N: total number of completions across all models
    - n_i: number of completions for this model
    """

    def __init__(
        self,
        model_names: List[str],
        exploration_coef: float = 1.0,
        epsilon: float = 0.15,
        decay_factor: float = 0.95,
        state_file: Optional[str] = None
    ):
        """
        Initialize the bandit.

        Args:
            model_names: List of available model names
            exploration_coef: UCB exploration coefficient (c)
            epsilon: Probability of random exploration
            decay_factor: Factor to decay old observations (0-1)
            state_file: Path to persist state (optional)
        """
        self.exploration_coef = exploration_coef
        self.epsilon = epsilon
        self.decay_factor = decay_factor
        self.state_file = state_file

        # Initialize stats for each model
        self.models: Dict[str, ModelStats] = {
            name: ModelStats(name=name) for name in model_names
        }

        # Baseline score for normalizing improvements
        self._baseline_score: float = 0.0

        # Load existing state if available
        if state_file and Path(state_file).exists():
            self.load()

    def set_baseline(self, score: float) -> None:
        """Set baseline score (typically the best score at start)."""
        self._baseline_score = score

    @property
    def total_completions(self) -> int:
        """Total number of completed evaluations across all models."""
        return sum(m.n_completed for m in self.models.values())

    def _ucb_score(self, stats: ModelStats) -> float:
        """
        Calculate UCB score for a model.

        Returns high value for:
        - Models with high mean improvement
        - Models that haven't been tried much (exploration bonus)
        """
        n_total = max(self.total_completions, 1)
        n_model = max(stats.n_completed, 1)

        # Mean improvement (can be negative)
        mean = stats.mean_improvement

        # Exploration bonus
        exploration = self.exploration_coef * math.sqrt(
            2 * math.log(n_total) / n_model
        )

        return mean + exploration

    def select_model(self, available_models: Optional[List[str]] = None) -> str:
        """
        Select a model using UCB with epsilon-greedy exploration.

        Args:
            available_models: Subset of models to choose from (optional)

        Returns:
            Selected model name
        """
        if available_models is None:
            available_models = list(self.models.keys())

        # Filter to only available models
        candidates = [m for m in available_models if m in self.models]
        if not candidates:
            # Unknown models - add them and return random one
            for m in available_models:
                if m not in self.models:
                    self.models[m] = ModelStats(name=m)
            candidates = available_models

        # Epsilon-greedy: sometimes explore randomly
        if random.random() < self.epsilon:
            selected = random.choice(candidates)
            self._log(f"Exploration: randomly selected {selected}")
        else:
            # UCB selection
            # First try models that haven't been used
            unused = [m for m in candidates if self.models[m].n_completed == 0]
            if unused:
                selected = random.choice(unused)
                self._log(f"UCB: selected untried model {selected}")
            else:
                # Select by highest UCB score
                scores = {m: self._ucb_score(self.models[m]) for m in candidates}
                selected = max(scores, key=scores.get)
                self._log(f"UCB: selected {selected} (score={scores[selected]:.4f})")

        # Track submission
        self.models[selected].n_submitted += 1

        return selected

    def update(
        self,
        model_name: str,
        child_score: Optional[float],
        parent_score: Optional[float] = None
    ) -> float:
        """
        Update model statistics after evaluation.

        Args:
            model_name: The model that was used
            child_score: Score of the generated algorithm (None if failed)
            parent_score: Score of the parent algorithm (for computing improvement)

        Returns:
            The improvement value (0 if failed or no comparison)
        """
        if model_name not in self.models:
            self.models[model_name] = ModelStats(name=model_name)

        stats = self.models[model_name]

        # Failed evaluation
        if child_score is None:
            stats.n_completed += 1
            # Count failures as slight negative improvement
            improvement = -0.1
            stats.total_improvement += improvement
            self._log(f"Update {model_name}: failed (imp={improvement:.4f})")
            self._apply_decay()
            self.save()
            return improvement

        # Calculate improvement
        if parent_score is not None:
            improvement = child_score - parent_score
        else:
            # No parent - compare to baseline
            improvement = child_score - self._baseline_score

        stats.n_completed += 1
        stats.total_improvement += improvement

        self._log(f"Update {model_name}: imp={improvement:.4f}, mean={stats.mean_improvement:.4f}")

        self._apply_decay()
        self.save()

        return improvement

    def _apply_decay(self) -> None:
        """Apply decay to reduce influence of old observations."""
        for stats in self.models.values():
            # Decay both counts and totals proportionally
            stats.total_improvement *= self.decay_factor
            # Don't decay counts below a small floor to preserve some memory
            if stats.n_completed > 1:
                stats.n_completed = max(1, int(stats.n_completed * self.decay_factor))

    def save(self) -> None:
        """Persist state to file."""
        if not self.state_file:
            return

        data = {
            'exploration_coef': self.exploration_coef,
            'epsilon': self.epsilon,
            'decay_factor': self.decay_factor,
            'baseline_score': self._baseline_score,
            'models': {
                name: {
                    'n_completed': stats.n_completed,
                    'n_submitted': stats.n_submitted,
                    'total_improvement': stats.total_improvement
                }
                for name, stats in self.models.items()
            },
            'updated_at': datetime.now().isoformat()
        }

        try:
            Path(self.state_file).parent.mkdir(parents=True, exist_ok=True)
            with open(self.state_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            self._log(f"Failed to save bandit state: {e}")

    def load(self) -> bool:
        """Load state from file."""
        if not self.state_file or not Path(self.state_file).exists():
            return False

        try:
            with open(self.state_file) as f:
                data = json.load(f)

            self.exploration_coef = data.get('exploration_coef', self.exploration_coef)
            self.epsilon = data.get('epsilon', self.epsilon)
            self.decay_factor = data.get('decay_factor', self.decay_factor)
            self._baseline_score = data.get('baseline_score', 0.0)

            for name, stats_data in data.get('models', {}).items():
                if name in self.models:
                    self.models[name].n_completed = stats_data.get('n_completed', 0)
                    self.models[name].n_submitted = stats_data.get('n_submitted', 0)
                    self.models[name].total_improvement = stats_data.get('total_improvement', 0.0)
                else:
                    self.models[name] = ModelStats(
                        name=name,
                        n_completed=stats_data.get('n_completed', 0),
                        n_submitted=stats_data.get('n_submitted', 0),
                        total_improvement=stats_data.get('total_improvement', 0.0)
                    )

            self._log(f"Loaded bandit state: {len(self.models)} models, {self.total_completions} completions")
            return True

        except Exception as e:
            self._log(f"Failed to load bandit state: {e}")
            return False

    def print_summary(self) -> None:
        """Print a summary of model performance."""
        print("\n=== LLM Bandit Summary ===", file=sys.stderr)
        print(f"Total completions: {self.total_completions}", file=sys.stderr)
        print(f"Exploration coef: {self.exploration_coef}, epsilon: {self.epsilon}", file=sys.stderr)
        print(f"Baseline score: {self._baseline_score:.4f}", file=sys.stderr)
        print("-" * 60, file=sys.stderr)
        print(f"{'Model':<25} {'N':>5} {'Mean Imp':>10} {'UCB':>10}", file=sys.stderr)
        print("-" * 60, file=sys.stderr)

        # Sort by UCB score
        sorted_models = sorted(
            self.models.values(),
            key=lambda m: self._ucb_score(m),
            reverse=True
        )

        for stats in sorted_models:
            ucb = self._ucb_score(stats)
            print(
                f"{stats.name:<25} {stats.n_completed:>5} "
                f"{stats.mean_improvement:>10.4f} {ucb:>10.4f}",
                file=sys.stderr
            )

        print("=" * 60, file=sys.stderr)

    def _log(self, msg: str) -> None:
        """Log message to stderr."""
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] [BANDIT] {msg}", file=sys.stderr, flush=True)


def get_bandit_for_evolution(evolution_dir: str, models: List[str]) -> LLMBandit:
    """
    Get or create a bandit instance for an evolution directory.

    Args:
        evolution_dir: Path to evolution directory
        models: List of available model names

    Returns:
        LLMBandit instance with state persistence
    """
    state_file = os.path.join(evolution_dir, "llm_bandit.json")
    return LLMBandit(
        model_names=models,
        state_file=state_file
    )


if __name__ == "__main__":
    # Test the bandit
    print("Testing LLM Bandit...")

    models = ["opus", "sonnet", "gemini-pro", "gpt5"]
    bandit = LLMBandit(models, state_file="/tmp/test_bandit.json")

    # Simulate some runs
    for i in range(20):
        model = bandit.select_model()
        # Simulate different model performance
        if model == "opus":
            score = random.gauss(0.2, 0.1)  # Good
        elif model == "sonnet":
            score = random.gauss(0.1, 0.1)  # Medium
        elif model == "gemini-pro":
            score = random.gauss(0.15, 0.15)  # Variable
        else:
            score = random.gauss(0.05, 0.1)  # Meh

        bandit.update(model, score, parent_score=0.0)

    bandit.print_summary()
