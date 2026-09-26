"""Synchronization, pattern fingerprinting, layered schedule merging, and self-healing reconstruction."""

from __future__ import annotations

import hashlib
import json
import logging
import asyncio
from typing import Dict, List, Optional, Any, Tuple, Callable, Awaitable
from datetime import datetime, timezone

from gb50.client import GB50Client
from gb50.models import ScheduleItem, GroupStatus
from gb50.exceptions import GB50ProtocolError
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
    lock = ev.get("remote_lock", "PERMIT") or "PERMIT"
    if hasattr(lock, "value"):
        lock = lock.value
    # For OFF events, controller temperature, mode, fan, and vane are irrelevant
    if d == "OFF":
        return f"{h:02d}:{m:02d}|OFF|||||{lock}"
    return f"{h:02d}:{m:02d}|{d}|{mode}|{temp_str}|{fan}|{vane}|{lock}"


def _daily_events_sig(events: List[Dict[str, Any]]) -> str:
    """Canonical signature for a single day's routine events."""
    sorted_events = sorted(events, key=lambda e: (e.get("hour", 0), e.get("minute", 0)))
    return ",".join(_event_key(e) for e in sorted_events)


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

    day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"}
    day_labels = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}

    if not active_days:
        return "Standby / Unscheduled", f"No scheduled timer events ({group_count} zones)"

    is_weekdays = (active_days == [1, 2, 3, 4, 5])
    is_all_week = (len(active_days) == 7)
    is_weekend = (active_days == [6, 7])

    time_span = ""
    if sample_on_time and sample_off_time:
        time_span = f" {sample_on_time} - {sample_off_time}"
    elif sample_on_time:
        time_span = f" from {sample_on_time}"

    temp_note = f" at {sample_temp_f}°F" if sample_temp_f else ""
    temp_suffix = f" ({sample_temp_f}°F)" if sample_temp_f else ""

    if len(active_days) == 1:
        d_name = day_names[active_days[0]]
        name = f"{d_name} Routine{time_span}{temp_suffix}"
        desc = f"Active {d_name}{temp_note} ({group_count} zones)"
    elif is_weekdays:
        name = f"Weekday Routine{time_span}{temp_suffix}"
        desc = f"Active Monday through Friday{temp_note} ({group_count} zones)"
    elif is_all_week:
        name = f"Daily Routine{time_span}{temp_suffix}"
        desc = f"Active 7 days a week{temp_note} ({group_count} zones)"
    elif is_weekend:
        name = f"Weekend Routine{time_span}{temp_suffix}"
        desc = f"Active Saturday and Sunday{temp_note} ({group_count} zones)"
    else:
        day_str = "/".join(day_labels[d] for d in active_days)
        name = f"{day_str} Schedule{time_span}{temp_suffix}"
        desc = f"Custom weekly routine ({group_count} zones)"

    return name, desc


def merge_programs_for_group(
    program_ids: List[int],
    season_id: Optional[int] = None,
) -> Tuple[Dict[int, List[Dict[str, Any]]], List[str]]:
    """
    Merge multiple layered schedule programs into a single coherent 7-day pattern (1=Mon .. 7=Sun).
    Optionally filters by season_id (1..5).
    Returns (merged_7day_pattern, list_of_warnings).
    """
    if not program_ids:
        return {d: [] for d in range(1, 8)}, []

    progs = []
    for pid in program_ids:
        p = schedule_db.get_schedule(pid)
        if p:
            if season_id is not None:
                p_season = p.get("season_id", 1)
                p_scope = p.get("season_scope", [str(p_season)])
                if p_season != season_id and "all" not in p_scope and str(season_id) not in p_scope:
                    continue
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

            drive_val = ev.get("drive")
            if hasattr(drive_val, "value"):
                drive_val = drive_val.value
            elif not drive_val:
                drive_val = "ON"

            mode_val = ev.get("mode")
            if hasattr(mode_val, "value"):
                mode_val = mode_val.value
            elif not mode_val:
                mode_val = "AUTO"

            fan_val = ev.get("fan_speed")
            if hasattr(fan_val, "value"):
                fan_val = fan_val.value
            elif not fan_val:
                fan_val = "AUTO"

            air_val = ev.get("air_direction")
            if hasattr(air_val, "value"):
                air_val = air_val.value
            elif not air_val:
                air_val = ""

            clean_events.append({
                "index": idx,
                "hour": ev.get("hour", 0),
                "minute": ev.get("minute", 0),
                "time_str": f"{ev.get('hour', 0):02d}:{ev.get('minute', 0):02d}",
                "drive": drive_val,
                "mode": mode_val,
                "set_temp_c": temp_c,
                "set_temp_f": temp_f,
                "fan_speed": fan_val,
                "air_direction": air_val,
                "remote_lock": (getattr(getattr(ev.get("remote_lock"), "value", None), "value", None) or getattr(ev.get("remote_lock"), "value", None) or ev.get("remote_lock") or "PERMIT"),
                "source_program_id": ev.get("_source_program_id"),
                "source_program_name": ev.get("_source_program_name"),
            })

        merged_pattern[day] = clean_events

    return merged_pattern, warnings


async def sync_group_hardware(client: GB50Client, group_id: int, season: int = 1) -> bool:
    """Recompute merged weekly pattern from all assigned programs and flash group hardware EEPROM for given season."""
    program_ids = schedule_db.get_program_ids_for_group(group_id)
    merged_pattern, _warnings = merge_programs_for_group(program_ids, season_id=season)
    expected_fp = fingerprint_pattern(merged_pattern)

    logger.info(f"Flashing merged Season {season} schedule ({len(program_ids)} programs) to group {group_id} across all 7 days...")
    try:
        for day in range(1, 8):
            events = merged_pattern.get(day, [])
            await client.set_weekly_schedule(
                group_ids=[group_id],
                day_of_week=day,
                events=events,
                season=season,
            )
            await asyncio.sleep(0.04)

        # Read-back verification
        try:
            hw_items = await client.get_weekly_schedule(group_id, season=season)
        except Exception as rex:
            logger.warning(f"Could not read back weekly schedule for group {group_id}: {rex}")
            hw_items = None

        if isinstance(hw_items, dict):
            hw_dict = {}
            for day, items in hw_items.items():
                if isinstance(items, (list, tuple)):
                    hw_dict[day] = [
                        {
                            "hour": getattr(item, "hour", item.get("hour") if isinstance(item, dict) else 0),
                            "minute": getattr(item, "minute", item.get("minute") if isinstance(item, dict) else 0),
                            "drive": (getattr(getattr(item, "drive", None), "value", None) or getattr(item, "drive", None) or (item.get("drive") if isinstance(item, dict) else "OFF") or "OFF"),
                            "mode": (getattr(getattr(item, "mode", None), "value", None) or getattr(item, "mode", None) or (item.get("mode") if isinstance(item, dict) else "AUTO") or "AUTO"),
                            "set_temp_c": getattr(item, "set_temp_c", item.get("set_temp_c") if isinstance(item, dict) else None),
                            "set_temp_f": round((getattr(item, "set_temp_c", item.get("set_temp_c") if isinstance(item, dict) else None) * 9.0 / 5.0) + 32.0, 1)
                            if getattr(item, "set_temp_c", item.get("set_temp_c") if isinstance(item, dict) else None) is not None
                            else None,
                            "fan_speed": (getattr(getattr(item, "fan_speed", None), "value", None) or getattr(item, "fan_speed", None) or (item.get("fan_speed") if isinstance(item, dict) else "") or ""),
                            "air_direction": (getattr(getattr(item, "air_direction", None), "value", None) or getattr(item, "air_direction", None) or (item.get("air_direction") if isinstance(item, dict) else "") or ""),
                            "remote_lock": (getattr(getattr(item, "remote_lock", None), "value", None) or getattr(item, "remote_lock", None) or (item.get("remote_lock") if isinstance(item, dict) else "PERMIT") or "PERMIT"),
                        }
                        for item in items
                    ]
            hw_fp = fingerprint_pattern(hw_dict)
            if hw_fp != expected_fp:
                logger.warning(
                    f"Read-back fingerprint mismatch for group {group_id} after flashing: expected {expected_fp}, got {hw_fp}"
                )
                schedule_db.set_sync_status(group_id, "DRIFT_DETECTED")
                return False

        schedule_db.set_sync_status(group_id, "SYNCED")
        return True
    except Exception as ex:
        logger.error(f"Failed to flash weekly schedule to group {group_id}: {ex}")
        schedule_db.set_sync_status(group_id, "ERROR")
        raise


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
    
    for g in groups:
        try:
            p_items = await client.get_weekly_schedule(g.group_id)
            p_dict: Dict[int, List[Dict[str, Any]]] = {}
            for day, items in p_items.items():
                p_dict[day] = [
                    {
                        "hour": item.hour,
                        "minute": item.minute,
                        "drive": item.drive.value if hasattr(item.drive, "value") else (item.drive or "OFF"),
                        "mode": item.mode.value if hasattr(item.mode, "value") else (item.mode or "AUTO"),
                        "set_temp_c": item.set_temp_c,
                        "set_temp_f": round((item.set_temp_c * 9.0 / 5.0) + 32.0, 1) if item.set_temp_c else None,
                        "fan_speed": item.fan_speed.value if hasattr(item.fan_speed, "value") else (item.fan_speed or ""),
                        "air_direction": item.air_direction.value if hasattr(item.air_direction, "value") else (item.air_direction or ""),
                    }
                    for item in items
                ]
            group_patterns[g.group_id] = p_dict
        except Exception as ex:
            logger.error(f"Cannot reconstruct schedules: failed to read weekly schedule for group {g.group_id} ({g.name}): {ex}")
            raise GB50ProtocolError(f"Failed to read weekly schedule for group {g.group_id} ({g.name}): {ex}") from ex
        await asyncio.sleep(0.04)

    # Cluster daily routines: each cluster contains active days with the exact same times and events.
    # Key: (daily_sig, tuple(sorted(active_days))) -> list of group_ids
    clusters: Dict[Tuple[str, Tuple[int, ...]], List[int]] = {}
    cluster_sample_events: Dict[Tuple[str, Tuple[int, ...]], List[Dict[str, Any]]] = {}

    for gid, pat in group_patterns.items():
        zone_routines: Dict[str, Tuple[List[int], List[Dict[str, Any]]]] = {}
        for day in range(1, 8):
            day_events = pat.get(day, [])
            if not day_events:
                continue
            sig = _daily_events_sig(day_events)
            if sig not in zone_routines:
                zone_routines[sig] = ([day], day_events)
            else:
                zone_routines[sig][0].append(day)

        for sig, (days, sample_events) in zone_routines.items():
            cluster_key = (sig, tuple(sorted(days)))
            clusters.setdefault(cluster_key, []).append(gid)
            if cluster_key not in cluster_sample_events:
                cluster_sample_events[cluster_key] = sample_events

    if force:
        for s in schedule_db.list_schedules():
            schedule_db.delete_schedule(s["id"])

    color_idx = 0
    created_programs = []
    # Sort clusters: largest zone groups first
    sorted_cluster_keys = sorted(
        clusters.keys(),
        key=lambda k: -len(clusters[k])
    )

    for idx, cluster_key in enumerate(sorted_cluster_keys, 1):
        gids = sorted(clusters[cluster_key])
        sample_events = cluster_sample_events[cluster_key]
        active_days = list(cluster_key[1])

        # Build 7-day pattern where only active_days have the sample events
        pat: Dict[int, List[Dict[str, Any]]] = {
            d: [dict(e) for e in sample_events] if d in active_days else []
            for d in range(1, 8)
        }

        name, desc = generate_smart_name(pat, len(gids), idx)
        color = DEFAULT_COLORS[color_idx % len(DEFAULT_COLORS)]
        color_idx += 1

        first_on = next((e for e in sample_events if e.get("drive") != "OFF"), None)
        first_off = next((e for e in sample_events if e.get("drive") == "OFF"), None)
        sample_on_time = f"{first_on['hour']:02d}:{first_on['minute']:02d}" if first_on else None
        sample_off_time = f"{first_off['hour']:02d}:{first_off['minute']:02d}" if first_off else None
        temp_c = first_on.get("set_temp_c") if first_on else None
        temp_f = round((temp_c * 9.0 / 5.0) + 32.0, 1) if temp_c is not None else 70.0
        mode = (first_on.get("mode") or "AUTO") if first_on else "AUTO"
        thermo = all(e.get("remote_lock") != "PROHIBIT" for e in sample_events)

        meta = {
            "days": active_days,
            "occupied_start": sample_on_time,
            "occupied_end": sample_off_time,
            "temperature_f": temp_f,
            "mode": mode,
            "thermostat_adjustments_allowed": thermo,
            "recurrence_kind": "weekly",
            "status": "published",
        }

        # Deduplicate schedule names if multiple routines happen to share the same name
        base_name = name
        dup_count = 1
        existing_names = {p["name"] for p in created_programs}
        while name in existing_names:
            dup_count += 1
            name = f"{base_name} ({dup_count})"

        prog = schedule_db.create_schedule(
            name=name,
            description=desc,
            color=color,
            weekly_pattern=pat,
            assigned_group_ids=gids,
            metadata_json=meta,
        )
        created_programs.append(prog)

    # Reconstruction reads ground truth directly from the controller; clear any pending syncs
    schedule_db.clear_all_pending_group_syncs()

    logger.info(f"Successfully auto-reconstructed {len(created_programs)} schedule programs in SQLite DB (grouped by exact daily times; skipped empty zones).")
    return schedule_db.list_schedules()


async def publish_schedule_to_hardware(
    client: GB50Client,
    schedule_id: int,
    progress_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    removed_group_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Publish schedule changes to controller hardware EEPROM, tracking per-room success and errors,
    and synchronizing/wiping any rooms removed from this schedule."""
    prog = schedule_db.get_schedule(schedule_id)
    if not prog:
        raise ValueError(f"Schedule program {schedule_id} not found")

    gids = list(prog.get("assigned_group_ids") or [])
    season_id = prog.get("season_id", 1)
    season_scope = prog.get("season_scope", [str(season_id)])

    seasons_to_sync: List[int] = []
    if "all" in season_scope:
        seasons_to_sync = [1, 2, 3, 4, 5]
    else:
        for s in season_scope:
            if s.isdigit() and 1 <= int(s) <= 5:
                seasons_to_sync.append(int(s))
        if not seasons_to_sync:
            seasons_to_sync = [season_id]

    now_iso = datetime.now(timezone.utc).isoformat()

    # Collect removed group IDs (explicitly passed or from pending syncs table)
    rem_gids_set = set(removed_group_ids or [])
    pending_syncs = set(schedule_db.get_pending_group_syncs())
    all_removals = sorted(list((rem_gids_set | pending_syncs) - set(gids)))

    # Combined items to sync: (gid, is_removal)
    sync_items = [(gid, False) for gid in gids] + [(gid, True) for gid in all_removals]

    if not sync_items:
        meta = prog.get("metadata_json") or {}
        meta["status"] = "published"
        meta["published_at"] = now_iso
        schedule_db.update_schedule(schedule_id, metadata_json=meta)
        if progress_callback:
            try:
                await progress_callback({
                    "schedule_id": schedule_id,
                    "schedule_name": prog.get("name", ""),
                    "current": 0,
                    "total": 0,
                    "percent": 100,
                    "status": "completed",
                    "success": True,
                    "successful_count": 0,
                    "failed_count": 0,
                    "room_statuses": {},
                    "published_at": now_iso,
                })
            except Exception as p_ex:
                logger.debug("Error in progress_callback: %s", p_ex)

        return {
            "schedule_id": schedule_id,
            "success": True,
            "total_spaces": 0,
            "published_spaces": 0,
            "failed_spaces": 0,
            "successful_rooms": [],
            "failed_rooms": [],
            "published_at": now_iso,
        }

    successful_gids = set()
    failed_rooms = []
    zone_metadata_map = schedule_db.get_all_zone_metadata()
    total = len(sync_items)
    room_statuses: Dict[int, str] = {gid: "queued" for gid, _ in sync_items}

    logger.info(
        f"Publishing schedule '{prog['name']}' to {len(gids)} spaces and wiping/updating {len(all_removals)} removed spaces across seasons {seasons_to_sync}..."
    )
    for idx, (gid, is_removal) in enumerate(sync_items):
        z_meta = zone_metadata_map.get(gid, {})
        top_name = None
        if hasattr(client, "topology") and isinstance(client.topology, dict):
            top_dict = client.topology.get(gid)
            if isinstance(top_dict, dict):
                top_name = top_dict.get("name")
        room_name = z_meta.get("room_name") or top_name or f"Zone {gid}"
        action_status = "clearing" if is_removal else "flashing"
        room_statuses[gid] = action_status

        if progress_callback:
            try:
                await progress_callback({
                    "schedule_id": schedule_id,
                    "schedule_name": prog.get("name", ""),
                    "current": idx + 1,
                    "total": total,
                    "percent": int((idx / total) * 100),
                    "group_id": gid,
                    "room_name": room_name,
                    "is_removal": is_removal,
                    "status": action_status,
                    "successful_count": len(successful_gids),
                    "failed_count": len(failed_rooms),
                    "room_statuses": dict(room_statuses),
                })
            except Exception as p_ex:
                logger.debug("Error in progress_callback: %s", p_ex)

        room_success = True
        error_msg = None
        for s in set(seasons_to_sync):
            try:
                await sync_group_hardware(client, gid, season=s)
                await asyncio.sleep(0.04)
            except Exception as ex:
                room_success = False
                error_msg = str(ex)
                logger.error(f"Failed publishing group {gid} in season {s}: {ex}")
                break

        if room_success:
            successful_gids.add(gid)
            room_statuses[gid] = "removed" if is_removal else "success"
            if is_removal:
                schedule_db.clear_pending_group_sync(gid)
        else:
            failed_rooms.append({"group_id": gid, "error": error_msg or "Controller sync failed"})
            room_statuses[gid] = "failed"

        if progress_callback:
            try:
                await progress_callback({
                    "schedule_id": schedule_id,
                    "schedule_name": prog.get("name", ""),
                    "current": idx + 1,
                    "total": total,
                    "percent": int(((idx + 1) / total) * 100),
                    "group_id": gid,
                    "room_name": room_name,
                    "is_removal": is_removal,
                    "status": ("removed" if is_removal else "success") if room_success else "failed",
                    "error": error_msg,
                    "successful_count": len(successful_gids),
                    "failed_count": len(failed_rooms),
                    "room_statuses": dict(room_statuses),
                })
            except Exception as p_ex:
                logger.debug("Error in progress_callback: %s", p_ex)

    overall_success = (len(failed_rooms) == 0)

    # Persist publication status in metadata
    meta = prog.get("metadata_json") or {}
    meta["status"] = "published" if overall_success else "failed"
    meta["published_at"] = now_iso
    schedule_db.update_schedule(schedule_id, metadata_json=meta)

    if progress_callback:
        try:
            await progress_callback({
                "schedule_id": schedule_id,
                "schedule_name": prog.get("name", ""),
                "current": total,
                "total": total,
                "percent": 100,
                "status": "completed",
                "success": overall_success,
                "successful_count": len(successful_gids),
                "failed_count": len(failed_rooms),
                "room_statuses": dict(room_statuses),
                "published_at": now_iso,
            })
        except Exception as p_ex:
            logger.debug("Error in final progress_callback: %s", p_ex)

    return {
        "schedule_id": schedule_id,
        "success": overall_success,
        "total_spaces": total,
        "published_spaces": len(successful_gids),
        "failed_spaces": len(failed_rooms),
        "successful_rooms": sorted(list(successful_gids)),
        "failed_rooms": failed_rooms,
        "published_at": now_iso,
    }


async def push_schedule_to_hardware(
    client: GB50Client,
    schedule_id: int,
    removed_group_ids: Optional[List[int]] = None,
) -> bool:
    """Push schedule changes to controller hardware EEPROM (legacy wrapper)."""
    result = await publish_schedule_to_hardware(client, schedule_id, removed_group_ids=removed_group_ids)
    return result["success"]


async def sync_all_groups_hardware(client: GB50Client, season: int = 1) -> Dict[str, Any]:
    """Sync all groups on the controller with their merged schedule for a specific season."""
    all_groups = schedule_db.get_all_group_program_assignments()
    success_count = 0
    fail_count = 0
    for gid in all_groups.keys():
        try:
            await sync_group_hardware(client, gid, season=season)
            success_count += 1
            await asyncio.sleep(0.04)
        except Exception as ex:
            logger.error(f"Failed syncing group {gid} for season {season}: {ex}")
            fail_count += 1

    return {"season": season, "synced": success_count, "failed": fail_count}


async def sync_all_seasons_hardware(client: GB50Client) -> Dict[str, Any]:
    """Flash all 5 seasons for all groups to controller EEPROM."""
    total_synced = 0
    total_failed = 0
    for s in range(1, 6):
        res = await sync_all_groups_hardware(client, season=s)
        total_synced += res["synced"]
        total_failed += res["failed"]
    return {"total_synced": total_synced, "total_failed": total_failed}


async def check_schedule_drift(client: GB50Client, season: int = 1) -> Dict[int, str]:
    """Check if any zone's hardware pattern has drifted from its merged DB schedule for given season."""
    all_groups = schedule_db.get_all_group_program_assignments()
    drift_report = {}

    for gid, pids in all_groups.items():
        merged_pat, _ = merge_programs_for_group(pids, season_id=season)
        expected_fp = fingerprint_pattern(merged_pat)

        try:
            hw_items = await client.get_weekly_schedule(gid, season=season)
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
