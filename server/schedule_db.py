"""SQLite repository for named schedule programs and multi-program zone assignments (N:M)."""

from __future__ import annotations

import os
import json
import sqlite3
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from .auth import DB_PATH


class ScheduleProgramModel(BaseModel):
    """Pydantic model representing a named schedule program."""
    id: Optional[int] = None
    name: str = Field(..., max_length=50)
    description: str = Field("", max_length=200)
    color: str = Field("blue", max_length=20)
    weekly_pattern: Dict[int, List[Dict[str, Any]]] = Field(
        default_factory=lambda: {d: [] for d in range(1, 8)}
    )
    assigned_group_ids: List[int] = Field(default_factory=list)
    sync_status: str = Field("SYNCED", pattern="^(SYNCED|DRIFT_DETECTED|PENDING)$")
    weekly_hours: float = 0.0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ScheduleDatabase:
    """SQLite Database manager for Schedule Programs and Zone Assignments."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _init_db(self) -> None:
        """Initialize schedules and schedule_assignments tables with N:M composite key."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    color TEXT DEFAULT 'blue',
                    pattern_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

            # Check if schedule_assignments has single-column PK or composite PK
            cursor.execute("PRAGMA table_info(schedule_assignments)")
            cols = cursor.fetchall()
            if cols:
                pk_cols = [c["name"] for c in cols if c["pk"] > 0]
                if pk_cols == ["group_id"]:
                    # Migrate table to composite primary key (group_id, schedule_id)
                    cursor.execute("ALTER TABLE schedule_assignments RENAME TO schedule_assignments_old")
                    cursor.execute(
                        """
                        CREATE TABLE schedule_assignments (
                            group_id INTEGER NOT NULL,
                            schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
                            synced_at TEXT NOT NULL,
                            sync_status TEXT NOT NULL DEFAULT 'PENDING',
                            PRIMARY KEY (group_id, schedule_id)
                        )
                        """
                    )
                    cursor.execute(
                        """
                        INSERT OR IGNORE INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status)
                        SELECT group_id, schedule_id, synced_at, sync_status FROM schedule_assignments_old
                        """
                    )
                    cursor.execute("DROP TABLE schedule_assignments_old")
            else:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schedule_assignments (
                        group_id INTEGER NOT NULL,
                        schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
                        synced_at TEXT NOT NULL,
                        sync_status TEXT NOT NULL DEFAULT 'PENDING',
                        PRIMARY KEY (group_id, schedule_id)
                    )
                    """
                )
            conn.commit()

    def count_schedules(self) -> int:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM schedules")
            return cursor.fetchone()[0]

    def list_schedules(self) -> List[Dict[str, Any]]:
        """List all schedule programs with their assigned group IDs."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, description, color, pattern_json, created_at, updated_at
                FROM schedules
                ORDER BY id ASC
                """
            )
            rows = cursor.fetchall()
            
            # Fetch all assignments
            cursor.execute("SELECT group_id, schedule_id, sync_status FROM schedule_assignments")
            assignment_rows = cursor.fetchall()
            assignments_map: Dict[int, List[int]] = {}
            status_map: Dict[int, str] = {}
            for a in assignment_rows:
                sched_id = a["schedule_id"]
                assignments_map.setdefault(sched_id, []).append(a["group_id"])
                if a["sync_status"] == "DRIFT_DETECTED":
                    status_map[sched_id] = "DRIFT_DETECTED"
                elif a["sync_status"] == "PENDING" and status_map.get(sched_id) != "DRIFT_DETECTED":
                    status_map[sched_id] = "PENDING"

            results = []
            for row in rows:
                sid = row["id"]
                pattern = json.loads(row["pattern_json"])
                int_pattern = {int(k): v for k, v in pattern.items()}
                results.append({
                    "id": sid,
                    "name": row["name"],
                    "description": row["description"] or "",
                    "color": row["color"] or "blue",
                    "weekly_pattern": int_pattern,
                    "assigned_group_ids": sorted(assignments_map.get(sid, [])),
                    "sync_status": status_map.get(sid, "SYNCED"),
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                })
            return results

    def get_schedule(self, schedule_id: int) -> Optional[Dict[str, Any]]:
        """Get a single schedule program by ID."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, description, color, pattern_json, created_at, updated_at
                FROM schedules WHERE id = ?
                """,
                (schedule_id,),
            )
            row = cursor.fetchone()
            if not row:
                return None

            cursor.execute(
                "SELECT group_id, sync_status FROM schedule_assignments WHERE schedule_id = ?",
                (schedule_id,),
            )
            assign_rows = cursor.fetchall()
            assigned_groups = [r["group_id"] for r in assign_rows]
            sync_status = "SYNCED"
            for r in assign_rows:
                if r["sync_status"] == "DRIFT_DETECTED":
                    sync_status = "DRIFT_DETECTED"
                    break
                elif r["sync_status"] == "PENDING":
                    sync_status = "PENDING"

            pattern = json.loads(row["pattern_json"])
            int_pattern = {int(k): v for k, v in pattern.items()}

            return {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"] or "",
                "color": row["color"] or "blue",
                "weekly_pattern": int_pattern,
                "assigned_group_ids": sorted(assigned_groups),
                "sync_status": sync_status,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }

    def create_schedule(
        self,
        name: str,
        description: str = "",
        color: str = "blue",
        weekly_pattern: Optional[Dict[int, List[Dict[str, Any]]]] = None,
        assigned_group_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """Create a new named schedule program and optional initial assignments."""
        if weekly_pattern is None:
            weekly_pattern = {d: [] for d in range(1, 8)}

        str_pattern = {str(k): v for k, v in weekly_pattern.items()}
        now_str = datetime.now(timezone.utc).isoformat()

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO schedules (name, description, color, pattern_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name.strip(), description.strip(), color.strip(), json.dumps(str_pattern), now_str, now_str),
            )
            schedule_id = cursor.lastrowid

            if assigned_group_ids:
                for gid in assigned_group_ids:
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status)
                        VALUES (?, ?, ?, 'PENDING')
                        """,
                        (gid, schedule_id, now_str),
                    )
            conn.commit()

        return self.get_schedule(schedule_id)

    def update_schedule(
        self,
        schedule_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        color: Optional[str] = None,
        weekly_pattern: Optional[Dict[int, List[Dict[str, Any]]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update an existing schedule program."""
        existing = self.get_schedule(schedule_id)
        if not existing:
            return None

        updates = []
        params = []
        now_str = datetime.now(timezone.utc).isoformat()

        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if description is not None:
            updates.append("description = ?")
            params.append(description.strip())
        if color is not None:
            updates.append("color = ?")
            params.append(color.strip())
        if weekly_pattern is not None:
            str_pattern = {str(k): v for k, v in weekly_pattern.items()}
            updates.append("pattern_json = ?")
            params.append(json.dumps(str_pattern))

        updates.append("updated_at = ?")
        params.append(now_str)
        params.append(schedule_id)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"UPDATE schedules SET {', '.join(updates)} WHERE id = ?", params)
            cursor.execute(
                "UPDATE schedule_assignments SET sync_status = 'PENDING', synced_at = ? WHERE schedule_id = ?",
                (now_str, schedule_id),
            )
            conn.commit()

        return self.get_schedule(schedule_id)

    def delete_schedule(self, schedule_id: int) -> bool:
        """Delete a schedule program and cascade delete its assignments."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            cursor.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
            conn.commit()
            return cursor.rowcount > 0

    def assign_zones(self, schedule_id: int, group_ids: List[int]) -> bool:
        """Assign a list of zone IDs to a schedule program, replacing previous assignments for this program."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Remove existing assignments for this schedule
            cursor.execute("DELETE FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            for gid in group_ids:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status)
                    VALUES (?, ?, ?, 'PENDING')
                    """,
                    (gid, schedule_id, now_str),
                )
            conn.commit()
            return True

    def get_programs_for_group(self, group_id: int) -> List[Dict[str, Any]]:
        """Get all schedule programs assigned to a specific HVAC zone group."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT s.id, s.name, s.description, s.color, s.pattern_json, s.created_at, s.updated_at,
                       sa.sync_status, sa.synced_at
                FROM schedules s
                JOIN schedule_assignments sa ON s.id = sa.schedule_id
                WHERE sa.group_id = ?
                ORDER BY s.id ASC
                """,
                (group_id,),
            )
            rows = cursor.fetchall()
            results = []
            for row in rows:
                pattern = json.loads(row["pattern_json"])
                int_pattern = {int(k): v for k, v in pattern.items()}
                results.append({
                    "id": row["id"],
                    "name": row["name"],
                    "description": row["description"] or "",
                    "color": row["color"] or "blue",
                    "weekly_pattern": int_pattern,
                    "sync_status": row["sync_status"],
                    "synced_at": row["synced_at"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                })
            return results

    def get_program_ids_for_group(self, group_id: int) -> List[int]:
        """Get the list of schedule program IDs assigned to a specific HVAC group."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT schedule_id FROM schedule_assignments WHERE group_id = ? ORDER BY schedule_id ASC",
                (group_id,),
            )
            return [r["schedule_id"] for r in cursor.fetchall()]

    def assign_programs_to_group(self, group_id: int, program_ids: List[int]) -> bool:
        """Set the list of schedule programs assigned to a single HVAC group."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM schedule_assignments WHERE group_id = ?", (group_id,))
            for pid in program_ids:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status)
                    VALUES (?, ?, ?, 'PENDING')
                    """,
                    (group_id, pid, now_str),
                )
            conn.commit()
            return True

    def get_all_group_program_assignments(self) -> Dict[int, List[int]]:
        """Get a map of { group_id: [program_id, ...] } across all groups."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT group_id, schedule_id FROM schedule_assignments ORDER BY group_id, schedule_id")
            rows = cursor.fetchall()
            mapping: Dict[int, List[int]] = {}
            for r in rows:
                mapping.setdefault(r["group_id"], []).append(r["schedule_id"])
            return mapping

    def get_assignment_for_group(self, group_id: int) -> Optional[Dict[str, Any]]:
        """Get the primary assigned schedule program for a group (for backward compatibility)."""
        progs = self.get_programs_for_group(group_id)
        if not progs:
            return None
        return {
            "group_id": group_id,
            "schedule_id": progs[0]["id"],
            "schedule_ids": [p["id"] for p in progs],
            "sync_status": progs[0]["sync_status"],
            "synced_at": progs[0]["synced_at"],
        }

    def set_sync_status(self, group_id: int, status: str, schedule_id: Optional[int] = None) -> None:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if schedule_id is not None:
                cursor.execute(
                    "UPDATE schedule_assignments SET sync_status = ? WHERE group_id = ? AND schedule_id = ?",
                    (status, group_id, schedule_id),
                )
            else:
                cursor.execute(
                    "UPDATE schedule_assignments SET sync_status = ? WHERE group_id = ?",
                    (status, group_id),
                )
            conn.commit()


# Singleton instance
schedule_db = ScheduleDatabase()
