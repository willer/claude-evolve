#!/usr/bin/env python3
"""
Simple timestamped logging for claude-evolve.
Uses stderr with flush=True for real-time output.
Also writes to a log file if configured.

AIDEV-NOTE: Set CLAUDE_EVOLVE_LOG_DIR or call init_file_logging() to enable file logging.
"""

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Default prefix, can be set per-module
_prefix = "EVOLVE"

# File logging
_log_file = None
_log_dir = None


def set_prefix(prefix: str):
    """Set the log prefix (e.g., 'WORKER', 'IDEATE', 'RUN')."""
    global _prefix
    _prefix = prefix


def init_file_logging(log_dir: Optional[str] = None):
    """
    Initialize file logging to the specified directory.

    Creates a log file named evolve_YYYYMMDD.log in the log directory.
    If log_dir is None, uses CLAUDE_EVOLVE_LOG_DIR env var or the current directory.
    """
    global _log_file, _log_dir

    if log_dir:
        _log_dir = Path(log_dir)
    elif os.environ.get('CLAUDE_EVOLVE_LOG_DIR'):
        _log_dir = Path(os.environ['CLAUDE_EVOLVE_LOG_DIR'])
    elif os.environ.get('CLAUDE_EVOLVE_CONFIG'):
        # Use the directory containing the config file
        _log_dir = Path(os.environ['CLAUDE_EVOLVE_CONFIG']).parent
    else:
        _log_dir = Path.cwd()

    _log_dir.mkdir(parents=True, exist_ok=True)

    # Create daily log file
    date_str = datetime.now().strftime("%Y%m%d")
    log_path = _log_dir / f"evolve_{date_str}.log"

    try:
        _log_file = open(log_path, 'a', buffering=1)  # Line buffered
        log(f"File logging initialized: {log_path}")
    except Exception as e:
        print(f"[WARN] Could not open log file {log_path}: {e}", file=sys.stderr)
        _log_file = None


def _write_to_file(msg: str):
    """Write message to log file if configured."""
    global _log_file
    if _log_file:
        try:
            _log_file.write(msg + "\n")
            _log_file.flush()
        except Exception:
            pass  # Don't fail on log write errors


def log(msg: str, prefix: str = None):
    """Log with timestamp. Always flushes for real-time output."""
    ts = datetime.now().strftime("%H:%M:%S")
    date_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    p = prefix or _prefix
    pid = os.getpid()

    # Console output (short timestamp)
    console_msg = f"[{ts}] [{p}-{pid}] {msg}"
    print(console_msg, file=sys.stderr, flush=True)

    # File output (full timestamp)
    file_msg = f"[{date_ts}] [{p}-{pid}] {msg}"
    _write_to_file(file_msg)


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


def close_log():
    """Close the log file."""
    global _log_file
    if _log_file:
        try:
            _log_file.close()
        except Exception:
            pass
        _log_file = None


# Auto-initialize file logging if env var is set
if os.environ.get('CLAUDE_EVOLVE_LOG_DIR') or os.environ.get('CLAUDE_EVOLVE_CONFIG'):
    init_file_logging()
