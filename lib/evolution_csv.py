#!/usr/bin/env python3
"""
Unified CSV operations for claude-evolve system.
This module provides all CSV functionality to ensure dispatcher and worker
use identical logic for determining pending work and updating candidates.
"""

import csv
import sys
import os
import tempfile
import fcntl
import time
from typing import List, Tuple, Optional, Dict, Any


class EvolutionCSV:
    """Unified CSV operations for evolution system."""
    
    def __init__(self, csv_path: str, lock_timeout: int = 10):
        """Initialize with CSV file path and lock timeout."""
        self.csv_path = csv_path
        self.lock_timeout = lock_timeout
        self.lock_file = None
        
    def __enter__(self):
        """Context manager entry - acquire lock."""
        self._acquire_lock()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - release lock."""
        self._release_lock()
        
    def _acquire_lock(self):
        """Acquire exclusive lock on CSV file."""
        # Use same lock path as bash implementation for consistency
        csv_dir = os.path.dirname(self.csv_path)
        lock_path = os.path.join(csv_dir, ".evolution.csv.lock")
        end_time = time.time() + self.lock_timeout
        
        while time.time() < end_time:
            try:
                self.lock_file = open(lock_path, 'w')
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.lock_file.write(str(os.getpid()))
                self.lock_file.flush()
                return
            except (IOError, OSError):
                if self.lock_file:
                    self.lock_file.close()
                    self.lock_file = None
                time.sleep(0.01)
                
        raise RuntimeError(f"Failed to acquire CSV lock within {self.lock_timeout} seconds")
        
    def _release_lock(self):
        """Release CSV lock."""
        if self.lock_file:
            try:
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
                self.lock_file.close()
                # Use same lock path as bash implementation
                csv_dir = os.path.dirname(self.csv_path)
                lock_path = os.path.join(csv_dir, ".evolution.csv.lock")
                os.unlink(lock_path)
            except (IOError, OSError):
                pass
            finally:
                self.lock_file = None
                
    def _read_csv(self) -> List[List[str]]:
        """Read CSV file and return all rows."""
        if not os.path.exists(self.csv_path):
            return []
            
        with open(self.csv_path, 'r', newline='') as f:
            reader = csv.reader(f)
            return list(reader)
            
    def _write_csv(self, rows: List[List[str]]):
        """Write rows to CSV file atomically."""
        temp_path = f"{self.csv_path}.tmp.{os.getpid()}"
        
        try:
            with open(temp_path, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(rows)
            
            # Atomic move
            os.rename(temp_path, self.csv_path)
        except Exception:
            # Cleanup temp file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise
            
    def is_valid_candidate_row(self, row: List[str]) -> bool:
        """Check if a row represents a valid candidate."""
        if not row:
            return False
        if len(row) == 0:
            return False
        # First column should have a non-empty ID
        if not row[0] or row[0].strip() == '':
            return False
        return True
        
    def is_pending_candidate(self, row: List[str]) -> bool:
        """
        UNIFIED LOGIC: Check if a candidate row is pending (needs processing).
        This is the single source of truth for both dispatcher and worker.
        """
        if not self.is_valid_candidate_row(row):
            return False
            
        # Must have at least 5 columns to check status
        if len(row) < 5:
            return True  # Incomplete row is pending
            
        # Check status field (5th column, index 4)
        # Clean status: remove newlines and control characters, then normalize
        status = row[4].strip() if row[4] else ''
        # Remove any embedded newlines or control characters (CSV corruption)
        status = status.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
        status = ' '.join(status.split()).lower()  # Normalize whitespace and lowercase

        # Only blank, missing, or "pending" mean pending
        # "running" should NOT be considered pending to avoid duplicate processing
        if not status or status == 'pending':
            return True

        # Handle corrupted status fields that start with "pending"
        # e.g., "pending gen08-013" from CSV corruption
        if status.startswith('pending '):
            return True

        # Check for retry statuses
        if status.startswith('failed-retry'):
            return True

        return False
        
    def get_pending_candidates(self) -> List[Tuple[str, str]]:
        """Get list of pending candidate IDs and their current status (in reverse order)."""
        rows = self._read_csv()
        pending = []

        # Skip header row if it exists
        start_idx = 1 if rows and rows[0] and rows[0][0].lower() == 'id' else 0

        # Process in reverse order to match get_next_pending_candidate
        for i in range(len(rows) - 1, start_idx - 1, -1):
            row = rows[i]
            if self.is_pending_candidate(row):
                # Strip both whitespace and quotes to handle CSV corruption
                candidate_id = row[0].strip().strip('"')
                current_status = row[4].strip() if len(row) > 4 else ''
                pending.append((candidate_id, current_status))

        return pending
        
    def count_pending_candidates(self) -> int:
        """Count number of pending candidates."""
        return len(self.get_pending_candidates())
        
    def get_next_pending_candidate(self) -> Optional[Tuple[str, str]]:
        """
        Get the next pending candidate and mark it as 'running'.
        Returns (candidate_id, original_status) or None if no pending work.
        Processes candidates in REVERSE order (from end to beginning).
        """
        rows = self._read_csv()
        if not rows:
            return None

        # Skip header row if it exists
        start_idx = 1 if rows and rows[0] and rows[0][0].lower() == 'id' else 0

        # Process in reverse order - from last row to first data row
        for i in range(len(rows) - 1, start_idx - 1, -1):
            row = rows[i]

            if self.is_pending_candidate(row):
                # Strip both whitespace and quotes to handle CSV corruption
                candidate_id = row[0].strip().strip('"')
                original_status = row[4].strip() if len(row) > 4 else ''

                # Ensure row has at least 5 columns
                while len(row) < 5:
                    row.append('')

                # Mark as running
                row[4] = 'running'

                # Write back to CSV
                self._write_csv(rows)

                return (candidate_id, original_status)

        return None
        
    def update_candidate_status(self, candidate_id: str, new_status: str) -> bool:
        """Update the status of a specific candidate."""
        rows = self._read_csv()
        if not rows:
            return False
            
        updated = False
        
        # Skip header row if it exists
        start_idx = 1 if rows and rows[0] and rows[0][0].lower() == 'id' else 0
        
        for i in range(start_idx, len(rows)):
            row = rows[i]
            
            if self.is_valid_candidate_row(row) and row[0].strip().strip('"') == candidate_id.strip().strip('"'):
                # Ensure row has at least 5 columns
                while len(row) < 5:
                    row.append('')
                    
                row[4] = new_status
                updated = True
                break
                
        if updated:
            self._write_csv(rows)
            
        return updated
        
    def update_candidate_performance(self, candidate_id: str, performance: str) -> bool:
        """Update the performance of a specific candidate."""
        rows = self._read_csv()
        if not rows:
            return False
            
        updated = False
        
        # Skip header row if it exists
        start_idx = 1 if rows and rows[0] and rows[0][0].lower() == 'id' else 0
        
        for i in range(start_idx, len(rows)):
            row = rows[i]
            
            if self.is_valid_candidate_row(row) and row[0].strip().strip('"') == candidate_id.strip().strip('"'):
                # Ensure row has at least 4 columns
                while len(row) < 4:
                    row.append('')
                    
                row[3] = performance  # Performance is column 4 (index 3)
                updated = True
                break
                
        if updated:
            self._write_csv(rows)
            
        return updated
        
    def update_candidate_field(self, candidate_id: str, field_name: str, value: str) -> bool:
        """Update a specific field for a candidate by adding it as a new column if needed."""
        rows = self._read_csv()
        if not rows:
            return False
            
        # Check if we have a header row
        has_header = rows and rows[0] and rows[0][0].lower() == 'id'
        header_row = rows[0] if has_header else None
        
        # Find or add the field to header
        if has_header:
            # Normalize field names - lowercase for comparison
            field_lower = field_name.lower()
            field_index = None
            
            # Try to find existing column
            for i, col in enumerate(header_row):
                if col.lower() == field_lower:
                    field_index = i
                    break
            
            # If field doesn't exist, add it to header and extend all rows
            if field_index is None:
                field_index = len(header_row)
                header_row.append(field_name)
                # Extend all data rows with empty values for the new column
                for i in range(1, len(rows)):
                    while len(rows[i]) <= field_index:
                        rows[i].append('')
        else:
            # No header - we'll use predefined positions for known fields
            field_map = {
                'id': 0,
                'basedonid': 1,
                'description': 2,
                'performance': 3,
                'status': 4,
                'idea-llm': 5,
                'run-llm': 6
            }
            field_index = field_map.get(field_name.lower())
            if field_index is None:
                # Unknown field without header - can't update
                return False
        
        # Update the candidate's field
        updated = False
        start_idx = 1 if has_header else 0
        
        for i in range(start_idx, len(rows)):
            row = rows[i]
            # Strip quotes from both stored ID and search ID for comparison
            stored_id = row[0].strip().strip('"') if len(row) > 0 else ''
            search_id = candidate_id.strip().strip('"')
            if self.is_valid_candidate_row(row) and stored_id == search_id:
                # Ensure row has enough columns
                while len(row) <= field_index:
                    row.append('')
                    
                row[field_index] = value
                updated = True
                break
                
        if updated:
            self._write_csv(rows)
            
        return updated
        
    def get_candidate_info(self, candidate_id: str) -> Optional[Dict[str, str]]:
        """Get information about a specific candidate."""
        rows = self._read_csv()
        if not rows:
            return None
            
        # Skip header row if it exists
        start_idx = 1 if rows and rows[0] and rows[0][0].lower() == 'id' else 0
        
        for row in rows[start_idx:]:
            if self.is_valid_candidate_row(row) and row[0].strip().strip('"') == candidate_id.strip().strip('"'):
                return {
                    'id': row[0].strip().strip('"') if len(row) > 0 else '',
                    'basedOnId': row[1].strip() if len(row) > 1 else '',
                    'description': row[2].strip() if len(row) > 2 else '',
                    'performance': row[3].strip() if len(row) > 3 else '',
                    'status': row[4].strip() if len(row) > 4 else ''
                }
                
        return None
        
    def delete_candidate(self, candidate_id: str) -> bool:
        """Delete a candidate from the CSV file."""
        rows = self._read_csv()
        if not rows:
            return False
            
        # Check if we have a header row
        has_header = rows and rows[0] and rows[0][0].lower() == 'id'
        
        # Find and remove the candidate
        deleted = False
        new_rows = []
        
        # Keep header if it exists
        if has_header:
            new_rows.append(rows[0])
            start_idx = 1
        else:
            start_idx = 0
            
        for i in range(start_idx, len(rows)):
            row = rows[i]
            if self.is_valid_candidate_row(row) and row[0].strip().strip('"') == candidate_id.strip().strip('"'):
                deleted = True
                # Skip this row (delete it)
                continue
            new_rows.append(row)
                
        if deleted:
            self._write_csv(new_rows)
            
        return deleted

    def cleanup_corrupted_status_fields(self) -> int:
        """
        Detect and fix corrupted status fields (e.g., with embedded newlines).
        Returns the number of corrupted fields fixed.
        """
        rows = self._read_csv()
        if not rows:
            return 0

        fixed_count = 0
        has_header = rows and rows[0] and rows[0][0].lower() == 'id'
        start_idx = 1 if has_header else 0

        for i in range(start_idx, len(rows)):
            row = rows[i]
            if len(row) >= 5 and row[4]:
                original_status = row[4]
                # Apply the same cleaning logic as is_pending_candidate
                cleaned_status = original_status.strip()
                cleaned_status = cleaned_status.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
                cleaned_status = ' '.join(cleaned_status.split())

                # If status starts with a known status but has garbage after it, fix it
                for valid_status in ['pending', 'running', 'complete', 'failed', 'skipped']:
                    if cleaned_status.lower().startswith(valid_status + ' '):
                        # Corrupted status found - extract just the valid part
                        row[4] = valid_status
                        fixed_count += 1
                        print(f"[WARN] Fixed corrupted status in row {i}: '{original_status}' -> '{valid_status}'", file=sys.stderr)
                        break

        if fixed_count > 0:
            self._write_csv(rows)
            print(f"[INFO] Fixed {fixed_count} corrupted status field(s)", file=sys.stderr)

        return fixed_count

    def reset_stuck_candidates(self) -> int:
        """
        Reset 'running' candidates and unknown statuses to 'pending'.
        Should only be called when no workers are active.
        Returns the number of candidates reset.
        """
        rows = self._read_csv()
        if not rows:
            return 0

        reset_count = 0
        has_header = rows and rows[0] and rows[0][0].lower() == 'id'
        start_idx = 1 if has_header else 0

        valid_statuses = {'', 'pending', 'complete', 'failed', 'failed-ai-retry',
                         'failed-retry1', 'failed-retry2', 'failed-retry3', 'skipped',
                         'failed-parent-missing', 'running'}

        # Track seen IDs to detect duplicates
        seen_ids = {}

        for i in range(start_idx, len(rows)):
            if len(rows[i]) > 4:
                status = rows[i][4].strip() if rows[i][4] else ''
                candidate_id = rows[i][0].strip().strip('"') if rows[i] else ''

                # Check for duplicate IDs
                if candidate_id in seen_ids:
                    print(f'[WARN] Duplicate candidate ID found: {candidate_id} at rows {seen_ids[candidate_id]} and {i}', file=sys.stderr)
                    print(f'[WARN] Row {seen_ids[candidate_id]}: status={rows[seen_ids[candidate_id]][4] if len(rows[seen_ids[candidate_id]]) > 4 else "?"}', file=sys.stderr)
                    print(f'[WARN] Row {i}: status={status}', file=sys.stderr)
                else:
                    seen_ids[candidate_id] = i

                # Reset 'running' when no workers are active
                if status == 'running':
                    print(f'[INFO] Resetting stuck running candidate: {candidate_id} (row {i})', file=sys.stderr)
                    rows[i][4] = 'pending'
                    reset_count += 1
                # Reset unknown statuses
                elif status not in valid_statuses:
                    print(f'[WARN] Resetting unknown status "{status}" to pending: {candidate_id}', file=sys.stderr)
                    rows[i][4] = 'pending'
                    reset_count += 1

        if reset_count > 0:
            self._write_csv(rows)
            print(f'[INFO] Reset {reset_count} stuck/unknown candidates to pending', file=sys.stderr)

        return reset_count

    def count_stuck_candidates(self) -> int:
        """
        Count candidates that are stuck (running or have unknown status).
        Returns the number of stuck candidates.
        """
        rows = self._read_csv()
        if not rows:
            return 0

        stuck = 0
        has_header = rows and rows[0] and rows[0][0].lower() == 'id'
        start_idx = 1 if has_header else 0

        valid_statuses = {'', 'pending', 'complete', 'failed', 'failed-ai-retry',
                         'failed-retry1', 'failed-retry2', 'failed-retry3', 'skipped',
                         'failed-parent-missing'}

        for i in range(start_idx, len(rows)):
            if len(rows[i]) > 4:
                status = rows[i][4].strip() if rows[i][4] else ''
                # Count running and unknown statuses
                if status == 'running' or (status and status not in valid_statuses):
                    stuck += 1

        return stuck

    def has_pending_work(self) -> bool:
        """Check if there are any pending candidates. Used by dispatcher."""
        return self.count_pending_candidates() > 0


def main():
    """Command line interface for testing."""
    if len(sys.argv) < 3:
        print("Usage: evolution_csv.py <csv_file> <command> [args...]")
        print("Commands:")
        print("  list                    - List all pending candidates")
        print("  count                   - Count pending candidates") 
        print("  next                    - Get next pending candidate")
        print("  update <id> <status>    - Update candidate status")
        print("  perf <id> <performance> - Update candidate performance")
        print("  info <id>               - Get candidate info")
        print("  field <id> <field> <val>- Update specific field")
        print("  check                   - Check if has pending work")
        sys.exit(1)
        
    csv_file = sys.argv[1]
    command = sys.argv[2]
    
    try:
        with EvolutionCSV(csv_file) as csv_ops:
            if command == 'list':
                pending = csv_ops.get_pending_candidates()
                for candidate_id, status in pending:
                    print(f"{candidate_id}|{status}")
                    
            elif command == 'count':
                count = csv_ops.count_pending_candidates()
                print(count)
                
            elif command == 'next':
                result = csv_ops.get_next_pending_candidate()
                if result:
                    candidate_id, original_status = result
                    print(f"{candidate_id}|{original_status}")
                else:
                    print("")
                    
            elif command == 'update' and len(sys.argv) >= 5:
                candidate_id = sys.argv[3]
                new_status = sys.argv[4]
                success = csv_ops.update_candidate_status(candidate_id, new_status)
                if success:
                    print(f"Updated {candidate_id} to {new_status}")
                else:
                    print(f"Failed to update {candidate_id}")
                    sys.exit(1)
                    
            elif command == 'perf' and len(sys.argv) >= 5:
                candidate_id = sys.argv[3]
                performance = sys.argv[4]
                success = csv_ops.update_candidate_performance(candidate_id, performance)
                if success:
                    print(f"Updated {candidate_id} performance to {performance}")
                else:
                    print(f"Failed to update {candidate_id} performance")
                    sys.exit(1)
                    
            elif command == 'info' and len(sys.argv) >= 4:
                candidate_id = sys.argv[3]
                info = csv_ops.get_candidate_info(candidate_id)
                if info:
                    for key, value in info.items():
                        print(f"{key}: {value}")
                else:
                    print(f"Candidate {candidate_id} not found")
                    sys.exit(1)
                    
            elif command == 'check':
                has_work = csv_ops.has_pending_work()
                print("yes" if has_work else "no")
                
            elif command == 'field' and len(sys.argv) >= 5:
                candidate_id = sys.argv[3]
                field_name = sys.argv[4]
                value = sys.argv[5] if len(sys.argv) >= 6 else ''
                success = csv_ops.update_candidate_field(candidate_id, field_name, value)
                if success:
                    print(f"Updated {candidate_id} field {field_name} to {value}")
                else:
                    print(f"Failed to update {candidate_id} field {field_name}")
                    sys.exit(1)
                
            else:
                print(f"Unknown command: {command}")
                sys.exit(1)
                
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()