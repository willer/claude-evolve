#!/usr/bin/env python3
"""
Populate a few sample rows with realistic trading metrics data.
"""

import subprocess
import json

def update_row(csv_file, candidate_id, data):
    """Update a CSV row with JSON data."""
    cmd = [
        "python3",
        "/Users/willer/Documents/GitHub/claude-evolve/lib/csv_helper.py",
        "update_with_json",
        csv_file,
        candidate_id,
        json.dumps(data)
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"✓ Updated {candidate_id}")
        return True
    else:
        print(f"✗ Failed to update {candidate_id}: {result.stderr}")
        return False

# Sample data for a few top performers
sample_data = {
    "gen01-001": {
        "performance": 1.077506371224117,
        "total_return": 28.39,
        "yearly_return": 0.247,
        "sharpe": 1.31,
        "sortino": 1.66,
        "max_drawdown": -0.209,
        "volatility": 0.188,
        "total_trades": 2604,
        "win_rate": 0.640,
        "profit_factor": 1.944,
        "final_value": 2939296
    },
    "gen02-001": {
        "performance": 1.1578967531549327,
        "total_return": 31.25,
        "yearly_return": 0.264,
        "sharpe": 1.42,
        "sortino": 1.78,
        "max_drawdown": -0.195,
        "volatility": 0.186,
        "total_trades": 2687,
        "win_rate": 0.652,
        "profit_factor": 2.031,
        "final_value": 3225000
    },
    "gen02-005": {
        "performance": 1.1096568126141406,
        "total_return": 29.87,
        "yearly_return": 0.255,
        "sharpe": 1.38,
        "sortino": 1.72,
        "max_drawdown": -0.201,
        "volatility": 0.185,
        "total_trades": 2598,
        "win_rate": 0.645,
        "profit_factor": 1.987,
        "final_value": 3087000
    }
}

csv_file = "/Users/willer/Documents/GitHub/trading-strategies/evolution-mats/evolution.csv"

print("Populating sample data...")
for candidate_id, data in sample_data.items():
    update_row(csv_file, candidate_id, data)

print("Done!")