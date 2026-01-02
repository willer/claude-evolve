#!/usr/bin/env python3
"""
Simple timestamped logging for claude-evolve.
Uses stderr with flush=True for real-time output.
"""

import os
import sys
from datetime import datetime

# Default prefix, can be set per-module
_prefix = "EVOLVE"


def set_prefix(prefix: str):
    """Set the log prefix (e.g., 'WORKER', 'IDEATE', 'RUN')."""
    global _prefix
    _prefix = prefix


def log(msg: str, prefix: str = None):
    """Log with timestamp. Always flushes for real-time output."""
    ts = datetime.now().strftime("%H:%M:%S")
    p = prefix or _prefix
    pid = os.getpid()
    print(f"[{ts}] [{p}-{pid}] {msg}", file=sys.stderr, flush=True)


def log_debug(msg: str, prefix: str = None):
    """Log debug message (only if DEBUG env var set)."""
    if os.environ.get('DEBUG') or os.environ.get('VERBOSE'):
        log(f"[DEBUG] {msg}", prefix)


def log_error(msg: str, prefix: str = None):
    """Log error message."""
    log(f"[ERROR] {msg}", prefix)


def log_warn(msg: str, prefix: str = None):
    """Log warning message."""
    log(f"[WARN] {msg}", prefix)
