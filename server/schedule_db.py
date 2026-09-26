"""SQLite repository for named schedule programs, seasons, and multi-program zone assignments (N:M)."""

from __future__ import annotations

import os
import json
import sqlite3
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from .auth import DB_PATH


class SeasonModel(BaseModel):
    """Pydantic model representing a global calendar season definition."""
    season_id: int = Field(..., ge=1, le=5, description="Season slot index (1..5)")
    name: str = Field(..., max_length=50, description="Friendly season label (e.g. Summer Cooling)")
    description: str = Field("", max_length=200, description="Season description")
    start_month: int = Field(0, ge=0, le=12, description="Start month (1..12 or 0)")
    start_day: int = Field(0, ge=0, le=31, description="Start day (1..31 or 0)")
    end_month: int = Field(0, ge=0, le=12, description="End month (1..12 or 0)")
    end_day: int = Field(0, ge=0, le=31, description="End day (1..31 or 0)")
    color: str = Field("blue", max_length=20, description="UI accent color")
    enabled: bool = Field(True, description="Whether season is actively used")
    is_active_today: bool = Field(False, description="Calculated true if today falls in this season")
    updated_at: Optional[str] = None


class ScheduleProgramModel(BaseModel):
    """Pydantic model representing a named schedule program."""
    id: Optional[int] = None
    name: str = Field(..., max_length=50)
    description: str = Field("", max_length=200)
    color: str = Field("blue", max_length=20)
    season_id: int = Field(1, ge=1, le=5, description="Primary Season ID (1..5)")
    season_scope: List[str] = Field(default_factory=lambda: ["1"], description="List of season IDs or ['all']")
    weekly_pattern: Dict[int, List[Dict[str, Any]]] = Field(
        default_factory=lambda: {d: [] for d in range(1, 8)}
    )
    assigned_group_ids: List[int] = Field(default_factory=list)
    sync_status: str = Field("SYNCED", pattern="^(SYNCED|DRIFT_DETECTED|PENDING|ERROR)$")
    weekly_hours: float = 0.0
    metadata_json: Optional[Dict[str, Any]] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ScheduleDatabase:
    """SQLite Database manager for Schedule Programs, Seasons, and Zone Assignments."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        db_dir = os.path.dirname(os.path.abspath(self.db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _init_db(self) -> None:
        """Initialize seasons, schedules, and schedule_assignments tables."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # 1. Create seasons table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS seasons (
                    season_id INTEGER PRIMARY KEY CHECK(season_id BETWEEN 1 AND 5),
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    start_month INTEGER NOT NULL DEFAULT 0,
                    start_day INTEGER NOT NULL DEFAULT 0,
                    end_month INTEGER NOT NULL DEFAULT 0,
                    end_day INTEGER NOT NULL DEFAULT 0,
                    color TEXT DEFAULT 'blue',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                )
                """
            )
            
            # Seed default 5 seasons if table is empty
            cursor.execute("SELECT COUNT(*) FROM seasons")
            if cursor.fetchone()[0] == 0:
                now_str = datetime.now(timezone.utc).isoformat()
                defaults = [
                    (1, "Summer Cooling", "Primary summer cooling schedule", 4, 1, 9, 30, "amber", 1, now_str),
                    (2, "Winter Heating", "Winter heating and setback schedule", 10, 1, 3, 31, "blue", 1, now_str),
                    (3, "Spring Transition", "Mild spring weather routine", 0, 0, 0, 0, "emerald", 0, now_str),
                    (4, "Fall Transition", "Mild autumn routine", 0, 0, 0, 0, "rose", 0, now_str),
                    (5, "Special Events", "Special seasonal events schedule", 0, 0, 0, 0, "purple", 0, now_str),
                ]
                cursor.executemany(
                    """
                    INSERT INTO seasons (season_id, name, description, start_month, start_day, end_month, end_day, color, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    defaults,
                )

            # 2. Create schedules table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    color TEXT DEFAULT 'blue',
                    season_id INTEGER DEFAULT 1 REFERENCES seasons(season_id),
                    season_scope TEXT DEFAULT '["1"]',
                    pattern_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            
            # Migrate schedules table if season columns are missing
            cursor.execute("PRAGMA table_info(schedules)")
            sched_cols = [c["name"] for c in cursor.fetchall()]
            if "season_id" not in sched_cols:
                cursor.execute("ALTER TABLE schedules ADD COLUMN season_id INTEGER DEFAULT 1")
            if "season_scope" not in sched_cols:
                cursor.execute("ALTER TABLE schedules ADD COLUMN season_scope TEXT DEFAULT '[\"1\"]'")
            if "metadata_json" not in sched_cols:
                cursor.execute("ALTER TABLE schedules ADD COLUMN metadata_json TEXT DEFAULT '{}'")

            # Create zone_metadata table for human room names and area groupings
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS zone_metadata (
                    group_id INTEGER PRIMARY KEY,
                    room_name TEXT NOT NULL,
                    area_name TEXT NOT NULL DEFAULT ''
                )
                """
            )

            # 3. Create schedule_assignments table with composite key
            cursor.execute("PRAGMA table_info(schedule_assignments)")
            cols = cursor.fetchall()
            if cols:
                pk_cols = [c["name"] for c in cols if c["pk"] > 0]
                if pk_cols == ["group_id"]:
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

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS pending_group_syncs (
                    group_id INTEGER PRIMARY KEY,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

            conn.commit()

    def seed_mock_defaults_if_empty(self) -> None:
        """Seed default 3 staff schedules from UX mock if schedules table is completely empty."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Seed default 3 staff schedules matching mock if schedules is empty
            cursor.execute("SELECT COUNT(*) FROM schedules")
            if cursor.fetchone()[0] == 0:
                now_str = datetime.now(timezone.utc).isoformat()
                # 1. Sunday Worship (Published)
                p1_pattern = compile_staff_schedule_pattern([7], "07:30", "13:00", 70.0, "AUTO", True)
                p1_meta = {
                    "occupied_start": "07:30",
                    "occupied_end": "13:00",
                    "temperature_f": 70.0,
                    "mode": "AUTO",
                    "thermostat_adjustments_allowed": True,
                    "recurrence_kind": "weekly",
                    "days": [7],
                    "start_date": "Apr 1",
                    "end_date": "Sep 30",
                    "status": "published",
                }
                cursor.execute(
                    "INSERT INTO schedules (id, name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (1, "Sunday Worship", "Occupied 07:30 - 13:00 at 70°F", "blue", 1, '["1"]', json.dumps(p1_pattern), json.dumps(p1_meta), now_str, now_str)
                )
                cursor.execute("INSERT INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status) VALUES (1, 1, ?, 'SYNCED')", (now_str,))
                cursor.execute("INSERT INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status) VALUES (2, 1, ?, 'SYNCED')", (now_str,))

                # 2. Weekday Office Hours (Published)
                p2_pattern = compile_staff_schedule_pattern([1, 2, 3, 4, 5], "08:00", "17:00", 72.0, "AUTO", True)
                p2_meta = {
                    "occupied_start": "08:00",
                    "occupied_end": "17:00",
                    "temperature_f": 72.0,
                    "mode": "AUTO",
                    "thermostat_adjustments_allowed": True,
                    "recurrence_kind": "weekly",
                    "days": [1, 2, 3, 4, 5],
                    "start_date": "Jan 1",
                    "end_date": "Dec 31",
                    "status": "published",
                }
                cursor.execute(
                    "INSERT INTO schedules (id, name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (2, "Weekday Office Hours", "Occupied 08:00 - 17:00 at 72°F", "emerald", 1, '["1"]', json.dumps(p2_pattern), json.dumps(p2_meta), now_str, now_str)
                )
                cursor.execute("INSERT INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status) VALUES (5, 2, ?, 'SYNCED')", (now_str,))

                # 3. Choir Rehearsal (Draft)
                p3_pattern = compile_staff_schedule_pattern([4], "18:00", "21:00", 70.0, "AUTO", True)
                p3_meta = {
                    "occupied_start": "18:00",
                    "occupied_end": "21:00",
                    "temperature_f": 70.0,
                    "mode": "AUTO",
                    "thermostat_adjustments_allowed": True,
                    "recurrence_kind": "weekly",
                    "days": [4],
                    "start_date": "Sep 15",
                    "end_date": "Dec 20",
                    "status": "draft",
                }
                cursor.execute(
                    "INSERT INTO schedules (id, name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (3, "Choir Rehearsal", "Occupied 18:00 - 21:00 at 70°F", "amber", 1, '["1"]', json.dumps(p3_pattern), json.dumps(p3_meta), now_str, now_str)
                )
                cursor.execute("INSERT INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status) VALUES (1, 3, ?, 'PENDING')", (now_str,))
                cursor.execute("INSERT INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status) VALUES (22, 3, ?, 'PENDING')", (now_str,))

            conn.commit()

    # --- Season Management ---

    def list_seasons(self, now_month: Optional[int] = None, now_day: Optional[int] = None) -> List[Dict[str, Any]]:
        """List all 5 seasons with calculated is_active_today flag."""
        if now_month is None or now_day is None:
            now = datetime.now()
            now_month = now.month
            now_day = now.day

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT season_id, name, description, start_month, start_day, end_month, end_day,
                       color, enabled, updated_at
                FROM seasons
                ORDER BY season_id ASC
                """
            )
            rows = cursor.fetchall()
            results = []
            for r in rows:
                sm = r["start_month"]
                sd = r["start_day"]
                em = r["end_month"]
                ed = r["end_day"]
                enabled = bool(r["enabled"])
                is_configured = (sm > 0 and sd > 0 and em > 0 and ed > 0)
                is_active = False

                if enabled and is_configured:
                    if sm < em or (sm == em and sd <= ed):
                        is_active = (sm, sd) <= (now_month, now_day) <= (em, ed)
                    else:
                        is_active = (now_month, now_day) >= (sm, sd) or (now_month, now_day) <= (em, ed)

                results.append({
                    "season_id": r["season_id"],
                    "name": r["name"],
                    "description": r["description"] or "",
                    "start_month": sm,
                    "start_day": sd,
                    "end_month": em,
                    "end_day": ed,
                    "color": r["color"] or "blue",
                    "enabled": enabled,
                    "is_active_today": is_active,
                    "updated_at": r["updated_at"],
                })
            return results

    def get_season(self, season_id: int) -> Optional[Dict[str, Any]]:
        """Get a single season configuration by ID (1..5)."""
        all_s = self.list_seasons()
        for s in all_s:
            if s["season_id"] == season_id:
                return s
        return None

    def update_season(
        self,
        season_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        start_month: Optional[int] = None,
        start_day: Optional[int] = None,
        end_month: Optional[int] = None,
        end_day: Optional[int] = None,
        color: Optional[str] = None,
        enabled: Optional[bool] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update a specific season configuration."""
        if not (1 <= season_id <= 5):
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
        if start_month is not None:
            updates.append("start_month = ?")
            params.append(int(start_month))
        if start_day is not None:
            updates.append("start_day = ?")
            params.append(int(start_day))
        if end_month is not None:
            updates.append("end_month = ?")
            params.append(int(end_month))
        if end_day is not None:
            updates.append("end_day = ?")
            params.append(int(end_day))
        if color is not None:
            updates.append("color = ?")
            params.append(color.strip())
        if enabled is not None:
            updates.append("enabled = ?")
            params.append(1 if enabled else 0)

        if not updates:
            return self.get_season(season_id)

        updates.append("updated_at = ?")
        params.append(now_str)
        params.append(season_id)

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"UPDATE seasons SET {', '.join(updates)} WHERE season_id = ?", params)
            conn.commit()

        return self.get_season(season_id)

    def update_all_seasons(self, seasons_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Update all 5 seasons in a single transaction."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            for s in seasons_list:
                sid = int(s.get("season_id") or s.get("season", 0))
                if not (1 <= sid <= 5):
                    continue
                name = str(s.get("name", f"Season {sid}")).strip()
                desc = str(s.get("description", "")).strip()
                sm = int(s.get("start_month", 0))
                sd = int(s.get("start_day", 0))
                em = int(s.get("end_month", 0))
                ed = int(s.get("end_day", 0))
                color = str(s.get("color", "blue")).strip()
                enabled = 1 if s.get("enabled", True) else 0

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO seasons (season_id, name, description, start_month, start_day, end_month, end_day, color, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (sid, name, desc, sm, sd, em, ed, color, enabled, now_str),
                )
            conn.commit()
        return self.list_seasons()

    # --- Schedule Program Management ---

    def count_schedules(self) -> int:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM schedules")
            return cursor.fetchone()[0]

    def list_schedules(self, season_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """List schedule programs, optionally filtered by season (1..5)."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at
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
            status_priority = {"ERROR": 4, "DRIFT_DETECTED": 3, "PENDING": 2, "SYNCED": 1}
            for a in assignment_rows:
                sched_id = a["schedule_id"]
                assignments_map.setdefault(sched_id, []).append(a["group_id"])
                curr_st = status_map.get(sched_id, "SYNCED")
                new_st = a["sync_status"] or "SYNCED"
                if status_priority.get(new_st, 0) > status_priority.get(curr_st, 0):
                    status_map[sched_id] = new_st

            results = []
            for row in rows:
                sid = row["id"]
                row_season_id = row["season_id"] if row["season_id"] is not None else 1
                try:
                    scope_list = json.loads(row["season_scope"] or "[]")
                except Exception:
                    scope_list = [str(row_season_id)]

                # Season filter check
                if season_id is not None:
                    matches_season = (
                        row_season_id == season_id
                        or "all" in scope_list
                        or str(season_id) in scope_list
                    )
                    if not matches_season:
                        continue

                pattern = json.loads(row["pattern_json"])
                int_pattern = {int(k): v for k, v in pattern.items()}
                
                try:
                    meta = json.loads(row["metadata_json"] or "{}")
                except Exception:
                    meta = {}

                results.append({
                    "id": sid,
                    "name": row["name"],
                    "description": row["description"] or "",
                    "color": row["color"] or "blue",
                    "season_id": row_season_id,
                    "season_scope": scope_list,
                    "weekly_pattern": int_pattern,
                    "metadata_json": meta,
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
                SELECT id, name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at
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
            status_priority = {"ERROR": 4, "DRIFT_DETECTED": 3, "PENDING": 2, "SYNCED": 1}
            sync_status = "SYNCED"
            for r in assign_rows:
                st = r["sync_status"] or "SYNCED"
                if status_priority.get(st, 0) > status_priority.get(sync_status, 0):
                    sync_status = st

            pattern = json.loads(row["pattern_json"])
            int_pattern = {int(k): v for k, v in pattern.items()}
            row_season_id = row["season_id"] if row["season_id"] is not None else 1
            try:
                scope_list = json.loads(row["season_scope"] or "[]")
            except Exception:
                scope_list = [str(row_season_id)]

            try:
                meta = json.loads(row["metadata_json"] or "{}")
            except Exception:
                meta = {}

            return {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"] or "",
                "color": row["color"] or "blue",
                "season_id": row_season_id,
                "season_scope": scope_list,
                "weekly_pattern": int_pattern,
                "metadata_json": meta,
                "assigned_group_ids": sorted(assigned_groups),
                "sync_status": sync_status,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }

    def _serialize_pattern(self, weekly_pattern: Optional[Dict[Any, Any]]) -> str:
        """Convert weekly pattern dict with Pydantic models or dicts to JSON string."""
        if weekly_pattern is None:
            weekly_pattern = {d: [] for d in range(1, 8)}
        str_pattern: Dict[str, List[Dict[str, Any]]] = {}
        for k, v in weekly_pattern.items():
            events_list = []
            for ev in (v or []):
                if hasattr(ev, "model_dump"):
                    d = ev.model_dump(exclude_unset=True)
                    if hasattr(ev, "resolved_temp_c"):
                        resolved = ev.resolved_temp_c()
                        if resolved is not None:
                            d["set_temp_c"] = resolved
                            d["set_temp_f"] = round((resolved * 9.0 / 5.0) + 32.0, 1)
                    events_list.append(d)
                elif isinstance(ev, dict):
                    d = dict(ev)
                    if d.get("set_temp_c") is None and d.get("set_temp_f") is not None:
                        d["set_temp_c"] = round(((float(d["set_temp_f"]) - 32.0) * 5.0 / 9.0) * 2.0) / 2.0
                    elif d.get("set_temp_f") is None and d.get("set_temp_c") is not None:
                        d["set_temp_f"] = round((float(d["set_temp_c"]) * 9.0 / 5.0) + 32.0, 1)
                    events_list.append(d)
                else:
                    events_list.append(ev)
            str_pattern[str(k)] = events_list
        return json.dumps(str_pattern)

    def create_schedule(
        self,
        name: str,
        description: str = "",
        color: str = "blue",
        weekly_pattern: Optional[Dict[Any, Any]] = None,
        assigned_group_ids: Optional[List[int]] = None,
        season_id: int = 1,
        season_scope: Optional[List[str]] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new named schedule program and optional initial assignments."""
        pattern_json = self._serialize_pattern(weekly_pattern)
        now_str = datetime.now(timezone.utc).isoformat()
        if season_scope is None:
            season_scope = [str(season_id)]
        scope_json = json.dumps(season_scope)
        meta_json_str = json.dumps(metadata_json or {})

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO schedules (name, description, color, season_id, season_scope, pattern_json, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name.strip(), description.strip(), color.strip(), season_id, scope_json, pattern_json, meta_json_str, now_str, now_str),
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
        weekly_pattern: Optional[Dict[Any, Any]] = None,
        season_id: Optional[int] = None,
        season_scope: Optional[List[str]] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
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
        if season_id is not None:
            updates.append("season_id = ?")
            params.append(int(season_id))
        if season_scope is not None:
            updates.append("season_scope = ?")
            params.append(json.dumps(season_scope))
        if weekly_pattern is not None:
            updates.append("pattern_json = ?")
            params.append(self._serialize_pattern(weekly_pattern))
        if metadata_json is not None:
            updates.append("metadata_json = ?")
            params.append(json.dumps(metadata_json))

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
        """Delete a schedule program and cascade delete its assignments, marking zones for pending hardware sync."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT group_id FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            gids = [r[0] for r in cursor.fetchall()]
            for gid in gids:
                cursor.execute(
                    "INSERT OR REPLACE INTO pending_group_syncs (group_id, reason, created_at) VALUES (?, 'SCHEDULE_DELETED', ?)",
                    (gid, now_str),
                )
            cursor.execute("DELETE FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            cursor.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
            conn.commit()
            return cursor.rowcount > 0

    def assign_zones(self, schedule_id: int, group_ids: List[int]) -> List[int]:
        """Assign a list of zone IDs to a schedule program, replacing previous assignments for this program.
        Any removed zones are tracked in pending_group_syncs so hardware can be cleared/updated.
        Returns the list of removed group IDs."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT group_id FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            old_gids = {r[0] for r in cursor.fetchall()}
            new_gids = set(group_ids)
            removed_gids = sorted(list(old_gids - new_gids))

            cursor.execute("DELETE FROM schedule_assignments WHERE schedule_id = ?", (schedule_id,))
            for gid in group_ids:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO schedule_assignments (group_id, schedule_id, synced_at, sync_status)
                    VALUES (?, ?, ?, 'PENDING')
                    """,
                    (gid, schedule_id, now_str),
                )
            for gid in removed_gids:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO pending_group_syncs (group_id, reason, created_at)
                    VALUES (?, 'UNASSIGNED', ?)
                    """,
                    (gid, now_str),
                )
            conn.commit()
            return removed_gids

    def assign_groups_to_schedule(self, schedule_id: int, group_ids: List[int]) -> List[int]:
        """Assign a list of zone/group IDs to a schedule program (alias for assign_zones)."""
        return self.assign_zones(schedule_id, group_ids)

    def get_pending_group_syncs(self) -> List[int]:
        """Get all group IDs pending hardware synchronization (e.g. unassigned or deleted)."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT group_id FROM pending_group_syncs")
            return [r[0] for r in cursor.fetchall()]

    def clear_pending_group_sync(self, group_id: int) -> None:
        """Clear a group from pending hardware synchronization."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM pending_group_syncs WHERE group_id = ?", (group_id,))
            conn.commit()

    def clear_all_pending_group_syncs(self) -> None:
        """Clear all pending hardware synchronization entries."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM pending_group_syncs")
            conn.commit()

    def add_pending_group_sync(self, group_id: int, reason: str = "UNASSIGNED") -> None:
        """Add a group to pending hardware synchronization."""
        now_str = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO pending_group_syncs (group_id, reason, created_at) VALUES (?, ?, ?)",
                (group_id, reason, now_str),
            )
            conn.commit()


    def get_programs_for_group(self, group_id: int, season_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get all schedule programs assigned to a specific HVAC zone, optionally filtered by season."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT s.id, s.name, s.description, s.color, s.season_id, s.season_scope, s.pattern_json, s.created_at, s.updated_at,
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
                row_season_id = row["season_id"] if row["season_id"] is not None else 1
                try:
                    scope_list = json.loads(row["season_scope"] or "[]")
                except Exception:
                    scope_list = [str(row_season_id)]

                if season_id is not None:
                    matches = (
                        row_season_id == season_id
                        or "all" in scope_list
                        or str(season_id) in scope_list
                    )
                    if not matches:
                        continue

                pattern = json.loads(row["pattern_json"])
                int_pattern = {int(k): v for k, v in pattern.items()}
                results.append({
                    "id": row["id"],
                    "name": row["name"],
                    "description": row["description"] or "",
                    "color": row["color"] or "blue",
                    "season_id": row_season_id,
                    "season_scope": scope_list,
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

    def get_assignment_for_group(self, group_id: int, season_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Get the primary assigned schedule program for a group."""
        progs = self.get_programs_for_group(group_id, season_id=season_id)
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

    # --- Season Cloning & Duplication Engine ---

    def duplicate_schedule(
        self,
        schedule_id: int,
        target_season_id: Optional[int] = None,
        name_suffix: str = " (Copy)",
        mode_transformation: str = "NONE",
        setpoint_offset_f: float = 0.0,
    ) -> Optional[Dict[str, Any]]:
        """Duplicate a single schedule program, optionally adapting modes and setpoints."""
        existing = self.get_schedule(schedule_id)
        if not existing:
            return None

        new_season_id = target_season_id if target_season_id is not None else existing["season_id"]
        new_name = f"{existing['name']}{name_suffix}"[:50]
        
        # Transform pattern events
        source_pattern = existing["weekly_pattern"]
        transformed_pattern: Dict[int, List[Dict[str, Any]]] = {}
        delta_c = setpoint_offset_f * 5.0 / 9.0

        for day, events in source_pattern.items():
            new_events = []
            for ev in events:
                item = dict(ev)
                # Mode transformation
                mode = item.get("mode")
                if mode_transformation == "COOL_TO_HEAT" and mode in ("COOL", "AUTOCOOL", "COOLING"):
                    item["mode"] = "HEAT"
                elif mode_transformation == "HEAT_TO_COOL" and mode in ("HEAT", "AUTOHEAT", "HEATING"):
                    item["mode"] = "COOL"
                elif mode_transformation == "INVERT":
                    if mode in ("COOL", "AUTOCOOL", "COOLING"):
                        item["mode"] = "HEAT"
                    elif mode in ("HEAT", "AUTOHEAT", "HEATING"):
                        item["mode"] = "COOL"

                # Setpoint offset
                st_c = item.get("set_temp_c")
                st_f = item.get("set_temp_f")
                if st_c is None and st_f is not None:
                    st_c = round(((float(st_f) - 32.0) * 5.0 / 9.0) * 2.0) / 2.0
                if st_f is None and st_c is not None:
                    st_f = round((float(st_c) * 9.0 / 5.0) + 32.0, 1)

                if st_f is not None and abs(setpoint_offset_f) > 0.01:
                    new_st_f = max(50.0, min(95.0, round(float(st_f) + setpoint_offset_f, 1)))
                    new_st_c = round(((new_st_f - 32.0) * 5.0 / 9.0) * 2.0) / 2.0
                    item["set_temp_f"] = new_st_f
                    item["set_temp_c"] = new_st_c

                new_events.append(item)
            transformed_pattern[day] = new_events

        # Create new program with identical assigned group IDs
        return self.create_schedule(
            name=new_name,
            description=existing.get("description", ""),
            color=existing.get("color", "blue"),
            weekly_pattern=transformed_pattern,
            assigned_group_ids=existing.get("assigned_group_ids", []),
            season_id=new_season_id,
            season_scope=[str(new_season_id)],
        )

    duplicate_program = duplicate_schedule

    def clone_season_schedules(
        self,
        source_season_id: int,
        target_season_id: int,
        mode_transformation: str = "NONE",
        setpoint_offset_f: float = 0.0,
        conflict_strategy: str = "REPLACE",
    ) -> List[Dict[str, Any]]:
        """Clone all schedule programs from source season to target season."""
        if not (1 <= source_season_id <= 5 and 1 <= target_season_id <= 5):
            raise ValueError(f"Invalid season IDs: source={source_season_id}, target={target_season_id}")
        if source_season_id == target_season_id:
            raise ValueError("Source and target seasons cannot be the same")

        # 1. Handle conflict strategy: REPLACE removes programs specifically scoped to target season
        if conflict_strategy == "REPLACE":
            existing_target = self.list_schedules(season_id=target_season_id)
            for p in existing_target:
                if p["season_id"] == target_season_id:
                    self.delete_schedule(p["id"])

        # 2. Fetch source season programs (only those specifically scoped to source_season_id, excluding year-round 'all')
        source_progs = [
            p for p in self.list_schedules(season_id=source_season_id)
            if p["season_id"] == source_season_id and "all" not in p.get("season_scope", [])
        ]
        
        created_progs = []
        target_season_info = self.get_season(target_season_id)
        season_label = target_season_info["name"] if target_season_info else f"Season {target_season_id}"

        for prog in source_progs:
            suffix = f" ({season_label})"
            cloned = self.duplicate_schedule(
                schedule_id=prog["id"],
                target_season_id=target_season_id,
                name_suffix=suffix,
                mode_transformation=mode_transformation,
                setpoint_offset_f=setpoint_offset_f,
            )
            if cloned:
                created_progs.append(cloned)

        return created_progs

    # --- Zone Metadata & Space Names ---

    def get_all_zone_metadata(self) -> Dict[int, Dict[str, str]]:
        """Retrieve all room name and area name mappings for zones."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT group_id, room_name, area_name FROM zone_metadata")
            rows = cursor.fetchall()
            return {
                int(r["group_id"]): {
                    "room_name": str(r["room_name"] or ""),
                    "area_name": str(r["area_name"] or ""),
                }
                for r in rows
            }

    def upsert_zone_metadata(self, group_id: int, room_name: str, area_name: str = "") -> Dict[str, Any]:
        """Save friendly room name and area grouping for a zone."""
        r_name = str(room_name).strip()
        a_name = str(area_name).strip()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO zone_metadata (group_id, room_name, area_name)
                VALUES (?, ?, ?)
                ON CONFLICT(group_id) DO UPDATE SET
                    room_name = excluded.room_name,
                    area_name = excluded.area_name
                """,
                (group_id, r_name, a_name),
            )
            conn.commit()
        return {"group_id": group_id, "room_name": r_name, "area_name": a_name}

    # --- Season Hardware Reconciliation ---

    def compare_seasons(self, hw_seasons: List[Any]) -> Dict[str, Any]:
        """Compare controller hardware seasons with DB seasons."""
        db_seasons = self.list_seasons()
        db_by_id = {s["season_id"]: s for s in db_seasons}
        mismatches = []
        for hw in hw_seasons:
            sid = getattr(hw, "season", None) if hasattr(hw, "season") else (hw.get("season") if isinstance(hw, dict) else None)
            if not sid or sid not in db_by_id:
                continue
            db_s = db_by_id[sid]
            hw_sm = getattr(hw, "start_month", 0) if hasattr(hw, "start_month") else (hw.get("start_month", 0) if isinstance(hw, dict) else 0)
            hw_sd = getattr(hw, "start_day", 0) if hasattr(hw, "start_day") else (hw.get("start_day", 0) if isinstance(hw, dict) else 0)
            hw_em = getattr(hw, "end_month", 0) if hasattr(hw, "end_month") else (hw.get("end_month", 0) if isinstance(hw, dict) else 0)
            hw_ed = getattr(hw, "end_day", 0) if hasattr(hw, "end_day") else (hw.get("end_day", 0) if isinstance(hw, dict) else 0)

            # Check if active dates match
            if db_s["enabled"]:
                if (db_s["start_month"] != hw_sm or db_s["start_day"] != hw_sd or
                    db_s["end_month"] != hw_em or db_s["end_day"] != hw_ed):
                    mismatches.append({
                        "season_id": sid,
                        "name": db_s["name"],
                        "db": {"start_month": db_s["start_month"], "start_day": db_s["start_day"], "end_month": db_s["end_month"], "end_day": db_s["end_day"]},
                        "controller": {"start_month": hw_sm, "start_day": hw_sd, "end_month": hw_em, "end_day": hw_ed},
                    })
        return {
            "reconciled": len(mismatches) == 0,
            "mismatches": mismatches,
            "db_seasons": db_seasons,
        }


def parse_time_str(t_str: str) -> Tuple[int, int]:
    """Parse time string supporting '07:30', '7:30 AM', '1:00 PM', '13:00'."""
    t_str = str(t_str).strip()
    upper = t_str.upper()
    is_pm = "PM" in upper
    is_am = "AM" in upper
    clean = upper.replace("AM", "").replace("PM", "").strip()
    parts = clean.split(":")
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 else 0
    if is_pm and h < 12:
        h += 12
    elif is_am and h == 12:
        h = 0
    return h, m


def compile_staff_schedule_pattern(
    days: List[int],
    occupied_start: str,
    occupied_end: str,
    temperature_f: float,
    mode: str = "AUTO",
    thermostat_adjustments_allowed: bool = True,
) -> Dict[int, List[Dict[str, Any]]]:
    """Compile an occupied interval and temperature into a deterministic 7-day pattern with paired ON/OFF events."""
    start_h, start_m = parse_time_str(occupied_start)
    end_h, end_m = parse_time_str(occupied_end)
    temp_c = round(((float(temperature_f) - 32.0) * 5.0 / 9.0) * 2.0) / 2.0
    remote_lock = "PERMIT" if thermostat_adjustments_allowed else "PROHIBIT"
    norm_mode = mode.upper()
    if norm_mode not in ("AUTO", "COOL", "HEAT", "FAN"):
        norm_mode = "AUTO"

    pattern: Dict[int, List[Dict[str, Any]]] = {d: [] for d in range(1, 8)}
    for day in days:
        if not (1 <= day <= 7):
            continue
        pattern[day] = [
            {
                "hour": start_h,
                "minute": start_m,
                "drive": "ON",
                "mode": norm_mode,
                "set_temp_c": temp_c,
                "set_temp_f": round(float(temperature_f), 1),
                "fan_speed": "AUTO",
                "air_direction": "HORIZONTAL",
                "remote_lock": remote_lock,
            },
            {
                "hour": end_h,
                "minute": end_m,
                "drive": "OFF",
                "mode": norm_mode,
                "set_temp_c": temp_c,
                "set_temp_f": round(float(temperature_f), 1),
                "fan_speed": "AUTO",
                "air_direction": "HORIZONTAL",
                "remote_lock": remote_lock,
            },
        ]
    return pattern


# Singleton instance
schedule_db = ScheduleDatabase()
