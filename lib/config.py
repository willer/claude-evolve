#!/usr/bin/env python3
"""Configuration loader for claude-evolve Python scripts."""

import os
import yaml
from pathlib import Path


class Config:
    """Configuration manager that matches the bash config.sh functionality."""
    
    # Default values matching config.sh
    DEFAULTS = {
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
        # Initialize working_dir with a default
        self.working_dir = Path('evolution')

        # Determine self.working_dir (EVOLUTION_DIR equivalent) based on specified logic
        if working_dir:
            self.working_dir = Path(working_dir)
        elif os.environ.get('CLAUDE_EVOLVE_WORKING_DIR'):
            self.working_dir = Path(os.environ.get('CLAUDE_EVOLVE_WORKING_DIR'))
        elif (Path('evolution') / 'evolution.csv').exists():
            self.working_dir = Path('evolution')
        elif Path('./evolution.csv').exists():
            self.working_dir = Path('.')

        # Determine local config file path relative to self.working_dir
        local_config_path = None
        if config_path:
            # Explicit config path provided, treat as local
            local_config_path = Path(config_path)
        else:
            local_config_path = self.working_dir / 'config.yaml'

        # Store the resolved config_path for path resolution later
        self.config_path = local_config_path

        # Load local config if it exists
        if local_config_path.exists():
            with open(local_config_path, 'r') as f:
                local_yaml_data = yaml.safe_load(f) or {}
                self._merge_config_data(local_yaml_data)

        # Load global config from ~/.config/claude-evolve/config.yaml
        global_config_path = Path.home() / '.config' / 'claude-evolve' / 'config.yaml'
        if global_config_path.exists():
            with open(global_config_path, 'r') as f:
                global_yaml_data = yaml.safe_load(f) or {}
                self._merge_config_data(global_yaml_data)

    def _merge_config_data(self, new_data):
        """Helper to merge new data into self.data, handling nested structures."""
        for key, value in new_data.items():
            if key in self.data and isinstance(self.data[key], dict) and isinstance(value, dict):
                # Recursively merge nested dictionaries
                self.data[key].update(value)
            else:
                # Overwrite or add other types of values
                self.data[key] = value
    
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