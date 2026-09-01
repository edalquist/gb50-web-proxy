"""Synchronization, pattern fingerprinting, layered schedule merging, and self-healing reconstruction."""

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
            is_on = (ev.get("drive") == "ON" or (ev.get("drive") != "OFF" and (ev.get("set_temp_c") is not None or ev.get("mode") is not None)))
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
                if (ev.get("drive") == "ON" or ev.get("drive") != "OFF") and sample_on_time is None:
                    sample_on_time = f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}"
                    if ev.get("set_temp_c"):
                        sample_temp_f = round((ev["set_temp_c"] * 9.0 / 5.0) + 32)
                elif ev.get("drive") == "OFF" and sample_off_time is None:
                    sample_off_time = f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}"

    if not active_days:
        return "Standby / Unscheduled", f"No scheduled timer events ({group_count} zones)"

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


def merge_programs_for_group(
    program_ids: List[int],
) -> Tuple[Dict[int, List[Dict[str, Any]]], List[str]]:
    """
    Merge multiple layered schedule programs into a single coherent 7-day pattern (1=Mon .. 7=Sun).
    Returns (merged_7day_pattern, list_of_warnings).
    """
    if not program_ids:
        return {d: [] for d in range(1, 8)}, []

    progs = []
    for pid in program_ids:
        p = schedule_db.get_schedule(pid)
        if p:
            progs.append(p)

    merged_pattern: Dict[int, List[Dict[str, Any]]] = {}
    warnings: List[str] = []

    for day in range(1, 8):
        day_events: List[Dict[str, Any]] = []
        for p in progs:
            p_events = p["weekly_pattern"].get(day, [])
            for ev in p_events:
                ev_copy = dict(ev)
                ev_copy["_source_program_id"] = p["id"]
                ev_copy["_source_program_name"] = p["name"]
                day_events.append(ev_copy)

        # De-duplicate / resolve same-minute events
        by_minute: Dict[int, Dict[str, Any]] = {}
        for ev in day_events:
            min_key = ev.get("hour", 0) * 60 + ev.get("minute", 0)
            if min_key in by_minute:
                existing = by_minute[min_key]
                # If current event is ON and existing is OFF, take ON
                if ev.get("drive") != "OFF" and existing.get("drive") == "OFF":
                    by_minute[min_key] = ev
                elif ev.get("drive") == "OFF" and existing.get("drive") != "OFF":
                    pass
                else:
                    # Same drive state, take latest defined
                    by_minute[min_key] = ev
            else:
                by_minute[min_key] = ev

        sorted_events = [by_minute[k] for k in sorted(by_minute.keys())]

        # GB-50 constraint: maximum 16 events per day
        if len(sorted_events) > 16:
            warnings.append(f"Day {day} exceeds GB-50 16-event limit ({len(sorted_events)} events). Truncating to first 16.")
            sorted_events = sorted_events[:16]

        clean_events = []
        for idx, ev in enumerate(sorted_events, 1):
            temp_c = ev.get("set_temp_c")
            temp_f = ev.get("set_temp_f")
            if temp_c is not None and temp_f is None:
                temp_f = round((temp_c * 9.0 / 5.0) + 32.0, 1)
            elif temp_f is not None and temp_c is None:
                temp_c = round(((temp_f - 32.0) * 5.0 / 9.0) * 2.0) / 2.0

            clean_events.append({
                "index": idx,
                "hour": ev.get("hour", 0),
                "minute": ev.get("minute", 0),
                "time_str": f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}",
                "drive": ev.get("drive", "ON"),
                "mode": ev.get("mode", "AUTO"),
                "set_temp_c": temp_c,
                "set_temp_f": temp_f,
                "fan_speed": ev.get("fan_speed", "AUTO"),
                "air_direction": ev.get("air_direction", ""),
                "source_program_id": ev.get("_source_program_id"),
                "source_program_name": ev.get("_source_program_name"),
            })

        merged_pattern[day] = clean_events

    return merged_pattern, warnings


async def sync_group_hardware(client: GB50Client, group_id: int) -> bool:
    """Recompute merged weekly pattern from all assigned programs and flash group hardware EEPROM."""
    program_ids = schedule_db.get_program_ids_for_group(group_id)
    merged_pattern, _warnings = merge_programs_for_group(program_ids)

    logger.info(f"Flashing merged schedule ({len(program_ids)} programs) to group {group_id} across all 7 days...")
    for day in range(1, 8):
        events = merged_pattern.get(day, [])
        await client.set_weekly_schedule(
            group_ids=[group_id],
            day_of_week=day,
            events=events,
        )

    schedule_db.set_sync_status(group_id, "SYNCED")
    return True


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
        await check_schedule_drift(client)
        return schedule_db.list_schedules()

    logger.info(f"Reconstructing schedule programs from {len(groups)} controller groups...")

    group_patterns: Dict[int, Dict[int, List[Dict[str, Any]]]] = {}
    
    async def _fetch_group_weekly(gid: int):
        try:
            p_items = await client.get_weekly_schedule(gid)
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

    clusters: Dict[str, List[int]] = {}
    cluster_sample_patterns: Dict[str, Dict[int, List[Dict[str, Any]]]] = {}

    for gid, pat in group_patterns.items():
        fp = fingerprint_pattern(pat)
        clusters.setdefault(fp, []).append(gid)
        if fp not in cluster_sample_patterns:
            cluster_sample_patterns[fp] = pat

    if force:
        for s in schedule_db.list_schedules():
            schedule_db.delete_schedule(s["id"])

    color_idx = 0
    created_programs = []
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
    """Push schedule changes to all groups that subscribe to this schedule program."""
    prog = schedule_db.get_schedule(schedule_id)
    if not prog or not prog["assigned_group_ids"]:
        return True

    gids = prog["assigned_group_ids"]
    logger.info(f"Re-syncing {len(gids)} groups subscribed to program '{prog['name']}'...")
    for gid in gids:
        await sync_group_hardware(client, gid)

    return True


async def check_schedule_drift(client: GB50Client) -> Dict[int, str]:
    """Check if any zone's hardware pattern has drifted from its merged DB schedule."""
    all_groups = schedule_db.get_all_group_program_assignments()
    drift_report = {}

    for gid, pids in all_groups.items():
        merged_pat, _ = merge_programs_for_group(pids)
        expected_fp = fingerprint_pattern(merged_pat)

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
            if hw_fp != expected_fp:
                schedule_db.set_sync_status(gid, "DRIFT_DETECTED")
                drift_report[gid] = "DRIFT_DETECTED"
            else:
                schedule_db.set_sync_status(gid, "SYNCED")
                drift_report[gid] = "SYNCED"
        except Exception as ex:
            logger.debug(f"Could not check drift for group {gid}: {ex}")

    return drift_report
