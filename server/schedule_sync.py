"""Synchronization, pattern fingerprinting, and self-healing reconstruction between GB-50 and SQLite."""

from __future__ import annotations

import hashlib
import json
import logging
import asyncio
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

from gb50.client import GB50Client
from gb50.models import ScheduleItem, GroupStatus
from .schedule_db import schedule_db, ScheduleProgramModel

logger = logging.getLogger("gb50.schedule_sync")

DEFAULT_COLORS = ["blue", "emerald", "purple", "amber", "rose", "indigo", "cyan", "teal"]


def _event_key(ev: Dict[str, Any]) -> str:
    """Normalize event to a canonical representation for fingerprinting."""
    h = ev.get("hour", 0)
    m = ev.get("minute", 0)
    d = ev.get("drive", "OFF")
    mode = ev.get("mode", "") or ""
    temp = ev.get("set_temp_c")
    temp_str = f"{temp:.1f}" if temp is not None else ""
    fan = ev.get("fan_speed", "") or ""
    vane = ev.get("air_direction", "") or ""
    return f"{h:02d}:{m:02d}|{d}|{mode}|{temp_str}|{fan}|{vane}"


def fingerprint_pattern(pattern: Dict[int, List[Dict[str, Any]]]) -> str:
    """Generate a deterministic SHA-256 hash for a 7-day weekly schedule pattern."""
    canonical_days = []
    total_events = 0
    for day in range(1, 8):
        day_events = pattern.get(day, [])
        total_events += len(day_events)
        sorted_events = sorted(day_events, key=lambda e: (e.get("hour", 0), e.get("minute", 0)))
        day_repr = ",".join(_event_key(e) for e in sorted_events)
        canonical_days.append(f"{day}:{day_repr}")

    if total_events == 0:
        return "EMPTY_SCHEDULE"

    raw_str = ";".join(canonical_days)
    return hashlib.sha256(raw_str.encode("utf-8")).hexdigest()[:16]


def calculate_weekly_runtime_hours(pattern: Dict[int, List[Dict[str, Any]]]) -> float:
    """Calculate approximate scheduled ON run-time in hours across a 7-day week."""
    total_minutes = 0
    for day in range(1, 8):
        events = sorted(pattern.get(day, []), key=lambda e: (e.get("hour", 0), e.get("minute", 0)))
        if not events:
            continue
        
        is_on = False
        last_time_min = 0
        for ev in events:
            ev_min = ev.get("hour", 0) * 60 + ev.get("minute", 0)
            if is_on:
                total_minutes += max(0, ev_min - last_time_min)
            is_on = (ev.get("drive") == "ON")
            last_time_min = ev_min
        
        if is_on:
            total_minutes += max(0, (24 * 60) - last_time_min)

    return round(total_minutes / 60.0, 1)


def generate_smart_name(
    pattern: Dict[int, List[Dict[str, Any]]],
    group_count: int,
    cluster_index: int = 1,
) -> Tuple[str, str]:
    """Generate human-readable name and description based on schedule pattern structure."""
    active_days = []
    sample_on_time = None
    sample_off_time = None
    sample_temp_f = None

    for day in range(1, 8):
        events = sorted(pattern.get(day, []), key=lambda e: (e.get("hour", 0), e.get("minute", 0)))
        if events:
            active_days.append(day)
            for ev in events:
                if ev.get("drive") == "ON" and sample_on_time is None:
                    sample_on_time = f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}"
                    if ev.get("set_temp_c"):
                        sample_temp_f = round((ev["set_temp_c"] * 9.0 / 5.0) + 32)
                elif ev.get("drive") == "OFF" and sample_off_time is None:
                    sample_off_time = f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}"

    if not active_days:
        return "Standby / Unscheduled", f"No scheduled timer events ({group_count} zones)"

    # Check for Mon-Fri pattern
    is_weekdays = (active_days == [1, 2, 3, 4, 5])
    is_all_week = (len(active_days) == 7)
    is_weekend = (active_days == [6, 7] or active_days == [7])

    time_span = ""
    if sample_on_time and sample_off_time:
        time_span = f" {sample_on_time} - {sample_off_time}"
    elif sample_on_time:
        time_span = f" from {sample_on_time}"

    temp_note = f" at {sample_temp_f}°F" if sample_temp_f else ""
    temp_suffix = f" ({sample_temp_f}°F)" if sample_temp_f else ""

    if is_weekdays:
        name = f"Weekday Routine{time_span}{temp_suffix}"
        desc = f"Active Monday through Friday{temp_note} ({group_count} zones)"
    elif is_all_week:
        name = f"Daily Routine{time_span}{temp_suffix}"
        desc = f"Active 7 days a week{temp_note} ({group_count} zones)"
    elif is_weekend:
        name = f"Weekend Routine{time_span}{temp_suffix}"
        desc = f"Active Saturday/Sunday{temp_note} ({group_count} zones)"
    else:
        day_labels = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
        day_str = "/".join(day_labels[d] for d in active_days[:3])
        name = f"{day_str} Schedule{time_span}{temp_suffix}"
        desc = f"Custom weekly routine ({group_count} zones)"

    return name, desc


async def reconstruct_schedules_from_controller(
    client: GB50Client,
    force: bool = False,
) -> List[Dict[str, Any]]:
    """Scan all groups on the GB-50 controller and self-heal / populate the SQLite database."""
    groups = await client.get_all_groups(refresh_topology=True)
    if not groups:
        return schedule_db.list_schedules()

    existing_count = schedule_db.count_schedules()
    if existing_count > 0 and not force:
        # Check drift instead of reconstructing
        await check_schedule_drift(client)
        return schedule_db.list_schedules()

    logger.info(f"Reconstructing schedule programs from {len(groups)} controller groups...")

    # Fetch 7-day pattern for each group
    group_patterns: Dict[int, Dict[int, List[Dict[str, Any]]]] = {}
    
    async def _fetch_group_weekly(gid: int):
        try:
            p_items = await client.get_weekly_schedule(gid)
            # Convert ScheduleItem objects to dictionary payloads
            p_dict: Dict[int, List[Dict[str, Any]]] = {}
            for day, items in p_items.items():
                p_dict[day] = [
                    {
                        "hour": item.hour,
                        "minute": item.minute,
                        "drive": item.drive,
                        "mode": item.mode,
                        "set_temp_c": item.set_temp_c,
                        "set_temp_f": round((item.set_temp_c * 9.0 / 5.0) + 32.0, 1) if item.set_temp_c else None,
                        "fan_speed": item.fan_speed,
                        "air_direction": item.air_direction,
                    }
                    for item in items
                ]
            group_patterns[gid] = p_dict
        except Exception as ex:
            logger.warning(f"Could not fetch weekly schedule for group {gid}: {ex}")
            group_patterns[gid] = {d: [] for d in range(1, 8)}

    tasks = [_fetch_group_weekly(g.group_id) for g in groups]
    await asyncio.gather(*tasks)

    # Cluster groups by pattern fingerprint
    clusters: Dict[str, List[int]] = {}
    cluster_sample_patterns: Dict[str, Dict[int, List[Dict[str, Any]]]] = {}

    for gid, pat in group_patterns.items():
        fp = fingerprint_pattern(pat)
        clusters.setdefault(fp, []).append(gid)
        if fp not in cluster_sample_patterns:
            cluster_sample_patterns[fp] = pat

    # Wipe existing if force
    if force:
        for s in schedule_db.list_schedules():
            schedule_db.delete_schedule(s["id"])

    # Create named schedule programs
    color_idx = 0
    created_programs = []
    # Sort clusters: active schedules first, then empty schedules
    sorted_fps = sorted(
        clusters.keys(),
        key=lambda k: (0 if k != "EMPTY_SCHEDULE" else 1, -len(clusters[k]))
    )

    for idx, fp in enumerate(sorted_fps, 1):
        gids = sorted(clusters[fp])
        pat = cluster_sample_patterns[fp]
        name, desc = generate_smart_name(pat, len(gids), idx)
        color = "slate" if fp == "EMPTY_SCHEDULE" else DEFAULT_COLORS[color_idx % len(DEFAULT_COLORS)]
        if fp != "EMPTY_SCHEDULE":
            color_idx += 1

        prog = schedule_db.create_schedule(
            name=name,
            description=desc,
            color=color,
            weekly_pattern=pat,
            assigned_group_ids=gids,
        )
        created_programs.append(prog)

    logger.info(f"Successfully auto-reconstructed {len(created_programs)} schedule programs in SQLite DB.")
    return schedule_db.list_schedules()


async def push_schedule_to_hardware(client: GB50Client, schedule_id: int) -> bool:
    """Push a database schedule program's 7-day pattern to all assigned controller zones."""
    prog = schedule_db.get_schedule(schedule_id)
    if not prog or not prog["assigned_group_ids"]:
        return True

    gids = prog["assigned_group_ids"]
    pat = prog["weekly_pattern"]

    logger.info(f"Writing schedule '{prog['name']}' to controller groups {gids} across all 7 days...")

    # Write each day 1..7 to hardware
    for day in range(1, 8):
        events = pat.get(day, [])
        await client.set_weekly_schedule(
            group_ids=gids,
            day_of_week=day,
            events=events,
        )

    # Mark as SYNCED
    for gid in gids:
        schedule_db.set_sync_status(gid, "SYNCED")

    return True


async def check_schedule_drift(client: GB50Client) -> Dict[int, str]:
    """Check if any zone's hardware pattern has drifted from its assigned DB schedule."""
    assignments = schedule_db.list_schedules()
    drift_report = {}

    for prog in assignments:
        prog_pat = prog["weekly_pattern"]
        prog_fp = fingerprint_pattern(prog_pat)

        for gid in prog["assigned_group_ids"]:
            try:
                hw_items = await client.get_weekly_schedule(gid)
                hw_dict = {
                    day: [
                        {
                            "hour": i.hour,
                            "minute": i.minute,
                            "drive": i.drive,
                            "mode": i.mode,
                            "set_temp_c": i.set_temp_c,
                            "fan_speed": i.fan_speed,
                            "air_direction": i.air_direction,
                        }
                        for i in items
                    ]
                    for day, items in hw_items.items()
                }
                hw_fp = fingerprint_pattern(hw_dict)
                if hw_fp != prog_fp:
                    schedule_db.set_sync_status(gid, "DRIFT_DETECTED")
                    drift_report[gid] = "DRIFT_DETECTED"
                else:
                    schedule_db.set_sync_status(gid, "SYNCED")
                    drift_report[gid] = "SYNCED"
            except Exception as ex:
                logger.debug(f"Could not check drift for group {gid}: {ex}")

    return drift_report
