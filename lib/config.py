#!/usr/bin/env python3
"""Configuration loader for claude-evolve Python scripts."""

import os
import yaml
from pathlib import Path


class Config:
    """Configuration manager that matches the bash config.sh functionality."""
    
    # Default values matching config.sh
    DEFAULTS = {
        'evolution_dir': 'evolution',
        'algorithm_file': 'algorithm.py',
        'evaluator_file': 'evaluator.py',
        'brief_file': 'BRIEF.md',
        'csv_file': 'evolution.csv',
        'output_dir': '',
        'parent_selection': 'best',
        'python_cmd': 'python3',
        'ideation': {
            'total_ideas': 15,
            'novel_exploration': 3,
            'hill_climbing': 5,
            'structural_mutation': 3,
            'crossover_hybrid': 4,
            'num_elites': 3,
            'num_revolution': 2
        },
        'parallel': {
            'enabled': False,
            'max_workers': 4,
            'lock_timeout': 10
        },
        'auto_ideate': True,
        'max_retries': 3
    }
    
    def __init__(self):
        self.data = self.DEFAULTS.copy()
        self.config_path = None
        self.working_dir = None
    
    def load(self, config_path=None, working_dir=None):
        """Load configuration from YAML file."""
        # Determine config file path
        if config_path:
            # Explicit config path provided
            self.config_path = Path(config_path)
        elif working_dir:
            # Look for config.yaml in working directory
            self.working_dir = Path(working_dir)
            self.config_path = self.working_dir / 'config.yaml'
        else:
            # Default to evolution/config.yaml
            self.config_path = Path('evolution/config.yaml')
        
        # Load config if it exists
        if self.config_path.exists():
            with open(self.config_path, 'r') as f:
                yaml_data = yaml.safe_load(f) or {}
                
                # Merge with defaults
                self.data.update(yaml_data)
                
                # Handle nested structures
                if 'ideation' in yaml_data:
                    self.data['ideation'] = {**self.DEFAULTS['ideation'], **yaml_data['ideation']}
                if 'parallel' in yaml_data:
                    self.data['parallel'] = {**self.DEFAULTS['parallel'], **yaml_data['parallel']}
    
    def resolve_path(self, relative_path):
        """Resolve a path relative to the config directory."""
        if not relative_path:
            return None
            
        # If config_path is set, use its parent directory
        if self.config_path:
            base_dir = self.config_path.parent
        elif self.working_dir:
            base_dir = self.working_dir
        else:
            base_dir = Path.cwd()
        
        # Handle output_dir special case
        if relative_path == self.data.get('output_dir', '') and not relative_path:
            # Empty output_dir means use evolution_dir
            relative_path = self.data.get('evolution_dir', 'evolution')
        
        resolved = base_dir / relative_path
        return str(resolved.resolve())