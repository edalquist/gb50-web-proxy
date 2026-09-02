"""Unit and integration tests for Schedule-First Database Architecture and Hardware Sync."""

import pytest
import os
import tempfile
import httpx
from datetime import datetime
from unittest.mock import AsyncMock

from server.schedule_db import ScheduleDatabase
from server.schedule_sync import (
    fingerprint_pattern,
    calculate_weekly_runtime_hours,
    generate_smart_name,
    reconstruct_schedules_from_controller,
    push_schedule_to_hardware,
)
from server.app import create_app
from gb50.models import SystemInfo, GroupStatus, GroupCapabilities, ScheduleItem
from gb50.constants import DriveState, OperationMode, AirDirection, FanSpeed, ModelType


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = ScheduleDatabase(db_path=path)
    yield db
    if os.path.exists(path):
        os.remove(path)


def test_schedule_db_crud(temp_db):
    assert temp_db.count_schedules() == 0

    # Create program
    pattern = {
        1: [{"hour": 8, "minute": 0, "drive": "ON", "mode": "AUTO", "set_temp_c": 21.5}],
        2: [{"hour": 8, "minute": 0, "drive": "ON", "mode": "AUTO", "set_temp_c": 21.5}],
        3: [],
        4: [],
        5: [],
        6: [],
        7: [],
    }
    prog = temp_db.create_schedule(
        name="Test Program",
        description="Test notes",
        color="emerald",
        weekly_pattern=pattern,
        assigned_group_ids=[1, 2],
    )
    assert prog["id"] is not None
    assert prog["name"] == "Test Program"
    assert prog["color"] == "emerald"
    assert prog["assigned_group_ids"] == [1, 2]
    assert temp_db.count_schedules() == 1

    # Get program
    fetched = temp_db.get_schedule(prog["id"])
    assert fetched is not None
    assert fetched["name"] == "Test Program"
    assert fetched["assigned_group_ids"] == [1, 2]

    # Update program
    updated = temp_db.update_schedule(
        prog["id"],
        name="Renamed Program",
        description="Updated notes",
        color="purple",
    )
    assert updated["name"] == "Renamed Program"
    assert updated["color"] == "purple"

    # Reassign zones
    temp_db.assign_zones(prog["id"], [3, 4, 5])
    refetched = temp_db.get_schedule(prog["id"])
    assert refetched["assigned_group_ids"] == [3, 4, 5]

    # Delete program
    assert temp_db.delete_schedule(prog["id"]) is True
    assert temp_db.count_schedules() == 0


def test_pattern_fingerprinting_and_runtime():
    empty_pat = {d: [] for d in range(1, 8)}
    assert fingerprint_pattern(empty_pat) == "EMPTY_SCHEDULE"
    assert calculate_weekly_runtime_hours(empty_pat) == 0.0

    weekday_pat = {
        1: [{"hour": 8, "minute": 0, "drive": "ON"}, {"hour": 17, "minute": 0, "drive": "OFF"}],
        2: [{"hour": 8, "minute": 0, "drive": "ON"}, {"hour": 17, "minute": 0, "drive": "OFF"}],
        3: [{"hour": 8, "minute": 0, "drive": "ON"}, {"hour": 17, "minute": 0, "drive": "OFF"}],
        4: [{"hour": 8, "minute": 0, "drive": "ON"}, {"hour": 17, "minute": 0, "drive": "OFF"}],
        5: [{"hour": 8, "minute": 0, "drive": "ON"}, {"hour": 17, "minute": 0, "drive": "OFF"}],
        6: [],
        7: [],
    }
    fp = fingerprint_pattern(weekday_pat)
    assert fp != "EMPTY_SCHEDULE"
    assert len(fp) == 16
    # 9 hours * 5 days = 45.0 hours
    assert calculate_weekly_runtime_hours(weekday_pat) == 45.0

    name, desc = generate_smart_name(weekday_pat, 6)
    assert "Weekday Routine" in name
    assert "08:00 - 17:00" in name
    assert "6 zones" in desc


@pytest.mark.asyncio
async def test_self_healing_reconstruction():
    from server.schedule_db import schedule_db

    # Mock client
    mock_client = AsyncMock()
    mock_groups = [
        GroupStatus(
            group_id=1, name="Room 101", model=ModelType.IC, address=1,
            slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
            air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
            schedule_enabled=True, filter_dirty=False, error_active=False,
            capabilities=GroupCapabilities(),
        ),
        GroupStatus(
            group_id=2, name="Room 102", model=ModelType.IC, address=2,
            slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
            air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
            schedule_enabled=True, filter_dirty=False, error_active=False,
            capabilities=GroupCapabilities(),
        ),
        GroupStatus(
            group_id=3, name="Storage", model=ModelType.IC, address=3,
            slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
            air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
            schedule_enabled=True, filter_dirty=False, error_active=False,
            capabilities=GroupCapabilities(),
        ),
    ]
    mock_client.get_all_groups = AsyncMock(return_value=mock_groups)

    # Zones 1 & 2 share a schedule; Zone 3 is empty
    sample_sched = {
        1: [ScheduleItem(index=1, hour=8, minute=0, drive=DriveState.ON, mode=OperationMode.AUTO, set_temp_c=21.0, time_str="08:00")],
        2: [ScheduleItem(index=1, hour=8, minute=0, drive=DriveState.ON, mode=OperationMode.AUTO, set_temp_c=21.0, time_str="08:00")],
        3: [], 4: [], 5: [], 6: [], 7: [],
    }
    empty_sched = {d: [] for d in range(1, 8)}

    async def _mock_get_weekly(gid):
        return sample_sched if gid in (1, 2) else empty_sched

    mock_client.get_weekly_schedule = AsyncMock(side_effect=_mock_get_weekly)

    # Trigger reconstruction
    progs = await reconstruct_schedules_from_controller(mock_client, force=True)
    assert len(progs) == 2  # 1 active schedule + 1 standby schedule

    active_prog = next(p for p in progs if set(p["assigned_group_ids"]) == {1, 2})
    assert active_prog is not None
    assert "Weekday" in active_prog["name"] or "Schedule" in active_prog["name"]

    standby_prog = next(p for p in progs if set(p["assigned_group_ids"]) == {3})
    assert standby_prog is not None
    assert "Standby" in standby_prog["name"] or "Unscheduled" in standby_prog["name"]


@pytest.mark.asyncio
async def test_rest_api_programs_endpoints():
    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    mock_client = app.state.client
    mock_client.get_system_info = AsyncMock(return_value=SystemInfo(
        version="2.80", model="GB-50ADA-A", serial_number="123", system_name="HQ HVAC",
        location_id="001", ip_address="192.0.2.90", subnet_mask="255.255.255.0",
        gateway="192.0.2.1", mac_address="001122334455", mnet_address=0, temp_unit="F",
        licensed_functions={},
    ))
    mock_client.get_all_groups = AsyncMock(return_value=[
        GroupStatus(
            group_id=1, name="Zone 1", model=ModelType.IC, address=1,
            slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
            air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
            schedule_enabled=True, filter_dirty=False, error_active=False,
            capabilities=GroupCapabilities(),
        )
    ])
    mock_client.get_weekly_schedule = AsyncMock(return_value={d: [] for d in range(1, 8)})
    mock_client.set_weekly_schedule = AsyncMock(return_value=True)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as Admin
        login_resp = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. List programs (triggers auto-reconstruct if empty)
        list_resp = await client.get("/api/v1/schedules/programs", headers=headers)
        assert list_resp.status_code == 200
        progs = list_resp.json()
        assert len(progs) >= 1

        # 2. Create program
        create_resp = await client.post(
            "/api/v1/schedules/programs",
            headers=headers,
            json={
                "name": "Custom Office Hours",
                "description": "Mon-Fri 8am-5pm",
                "color": "blue",
                "weekly_pattern": {
                    "1": [{"hour": 8, "minute": 0, "drive": "ON", "set_temp_f": 72.0}]
                },
                "assigned_group_ids": [1],
            },
        )
        assert create_resp.status_code == 200
        created = create_resp.json()
        assert created["name"] == "Custom Office Hours"
        assert created["assigned_group_ids"] == [1]

        # 3. Assign zones
        assign_resp = await client.post(
            f"/api/v1/schedules/programs/{created['id']}/assign",
            headers=headers,
            json={"group_ids": [1]},
        )
        assert assign_resp.status_code == 200

        # 4. Push to hardware
        push_resp = await client.post(
            f"/api/v1/schedules/programs/{created['id']}/push-to-hardware",
            headers=headers,
        )
        assert push_resp.status_code == 200
        assert push_resp.json()["status"] == "success"

        # 5. Multi-program assignment to Zone 1
        prog_sun = await client.post(
            "/api/v1/schedules/programs",
            headers=headers,
            json={
                "name": "Sunday Service",
                "description": "Sun 7am-1pm",
                "color": "emerald",
                "weekly_pattern": {
                    "7": [{"hour": 7, "minute": 0, "drive": "ON", "set_temp_f": 70.0}]
                },
                "assigned_group_ids": [],
            },
        )
        prog_wed = await client.post(
            "/api/v1/schedules/programs",
            headers=headers,
            json={
                "name": "Wednesday Youth",
                "description": "Wed 5:30pm-8:30pm",
                "color": "purple",
                "weekly_pattern": {
                    "3": [{"hour": 17, "minute": 30, "drive": "ON", "set_temp_f": 71.0}]
                },
                "assigned_group_ids": [],
            },
        )
        sun_id = prog_sun.json()["id"]
        wed_id = prog_wed.json()["id"]

        # Assign both programs to Zone 1
        zone_assign = await client.put(
            "/api/v1/schedules/zones/1/programs",
            headers=headers,
            json={"program_ids": [sun_id, wed_id]},
        )
        assert zone_assign.status_code == 200
        assigned_data = zone_assign.json()
        assert len(assigned_data["assigned_programs"]) == 2

        # Get zone programs
        zone_progs = await client.get("/api/v1/schedules/zones/1/programs", headers=headers)
        assert zone_progs.status_code == 200
        assert len(zone_progs.json()) == 2

        # Get merged schedule for Zone 1
        merged_res = await client.get("/api/v1/schedules/zones/1/merged", headers=headers)
        assert merged_res.status_code == 200
        merged_pattern = merged_res.json()["merged_pattern"]
        assert len(merged_pattern["7"]) == 1
        assert merged_pattern["7"][0]["source_program_name"] == "Sunday Service"
        assert len(merged_pattern["3"]) == 1
        assert merged_pattern["3"][0]["source_program_name"] == "Wednesday Youth"

        # Check assignments map
        all_assign = await client.get("/api/v1/schedules/assignments", headers=headers)
        assert all_assign.status_code == 200
        assert 1 in all_assign.json() or "1" in all_assign.json()

        # Clean up
        await client.delete(f"/api/v1/schedules/programs/{sun_id}", headers=headers)
        await client.delete(f"/api/v1/schedules/programs/{wed_id}", headers=headers)
        await client.delete(f"/api/v1/schedules/programs/{created['id']}", headers=headers)


def test_merge_programs_engine(temp_db):
    from server.schedule_sync import merge_programs_for_group

    p1 = temp_db.create_schedule(
        name="Morning Warmup",
        weekly_pattern={
            1: [{"hour": 6, "minute": 0, "drive": "ON", "set_temp_f": 70.0}],
            2: [{"hour": 6, "minute": 0, "drive": "ON", "set_temp_f": 70.0}],
        }
    )
    p2 = temp_db.create_schedule(
        name="Evening Youth",
        weekly_pattern={
            1: [{"hour": 18, "minute": 0, "drive": "ON", "set_temp_f": 72.0}, {"hour": 21, "minute": 0, "drive": "OFF"}],
            3: [{"hour": 18, "minute": 0, "drive": "ON", "set_temp_f": 72.0}],
        }
    )

    # Monkeypatch schedule_db for unit test
    import server.schedule_sync as sync_module
    old_db = sync_module.schedule_db
    sync_module.schedule_db = temp_db
    try:
        merged, warnings = merge_programs_for_group([p1["id"], p2["id"]])
        assert len(warnings) == 0
        # Day 1 should have 3 events: 06:00, 18:00, 21:00
        assert len(merged[1]) == 3
        assert merged[1][0]["time_str"] == "06:00"
        assert merged[1][0]["source_program_name"] == "Morning Warmup"
        assert merged[1][1]["time_str"] == "18:00"
        assert merged[1][1]["source_program_name"] == "Evening Youth"
        assert merged[1][2]["time_str"] == "21:00"

        # Day 2 should have 1 event (06:00)
        assert len(merged[2]) == 1
        # Day 3 should have 1 event (18:00)
        assert len(merged[3]) == 1
        # Day 4..7 should be empty
        assert len(merged[4]) == 0
    finally:
        sync_module.schedule_db = old_db


@pytest.mark.asyncio
async def test_schedule_sync_status_lifecycle_and_foreign_keys(temp_db):
    from server.schedule_sync import sync_group_hardware
    import server.schedule_sync as sync_module

    old_db = sync_module.schedule_db
    sync_module.schedule_db = temp_db

    try:
        # 1. Create program with assigned zone
        prog = temp_db.create_schedule(
            name="Sanctuary Weekly",
            weekly_pattern={1: [{"hour": 9, "minute": 0, "drive": "ON", "set_temp_f": 70.0}]},
            assigned_group_ids=[1],
        )
        # Initial status MUST be PENDING
        progs = temp_db.get_programs_for_group(1)
        assert len(progs) == 1
        assert progs[0]["sync_status"] == "PENDING"

        # 2. Hardware sync failure should mark status as ERROR
        mock_failing_client = AsyncMock()
        mock_failing_client.set_weekly_schedule.side_effect = Exception("Controller timeout")
        with pytest.raises(Exception, match="Controller timeout"):
            await sync_group_hardware(mock_failing_client, group_id=1)

        progs_after_fail = temp_db.get_programs_for_group(1)
        assert progs_after_fail[0]["sync_status"] == "ERROR"

        # 3. Successful hardware sync should mark status as SYNCED
        mock_success_client = AsyncMock()
        mock_success_client.set_weekly_schedule.return_value = True
        await sync_group_hardware(mock_success_client, group_id=1)

        progs_after_success = temp_db.get_programs_for_group(1)
        assert progs_after_success[0]["sync_status"] == "SYNCED"

        # 4. Test Foreign Key Cascades: Deleting program removes assignments
        temp_db.delete_schedule(prog["id"])
        assignments = temp_db.get_program_ids_for_group(1)
        assert len(assignments) == 0
    finally:
        sync_module.schedule_db = old_db


@pytest.mark.asyncio
async def test_schedule_sync_pacing_and_delays(temp_db):
    from unittest.mock import patch
    from server.schedule_sync import sync_group_hardware, push_schedule_to_hardware
    import server.schedule_sync as sync_module

    old_db = sync_module.schedule_db
    sync_module.schedule_db = temp_db

    try:
        prog = temp_db.create_schedule(
            name="Paced Program",
            weekly_pattern={1: [{"hour": 8, "minute": 0, "drive": "ON"}]},
            assigned_group_ids=[1, 2],
        )

        mock_client = AsyncMock()
        mock_client.set_weekly_schedule.return_value = True

        sleep_calls = []

        async def _mock_sleep(duration):
            sleep_calls.append(duration)

        with patch("server.schedule_sync.asyncio.sleep", side_effect=_mock_sleep):
            # Test sync_group_hardware paces 7 day uploads with 0.04s delay
            await sync_group_hardware(mock_client, group_id=1)
            assert len(sleep_calls) == 7
            assert all(d == 0.04 for d in sleep_calls)

            # Test push_schedule_to_hardware calls sync for each group and paces between groups
            sleep_calls.clear()
            await push_schedule_to_hardware(mock_client, schedule_id=prog["id"])
            # 2 groups * 7 days (14 sleeps in sync_group_hardware) + 2 sleeps in push_schedule_to_hardware = 16 sleeps
            assert len(sleep_calls) == 16
            assert all(d == 0.04 for d in sleep_calls)
    finally:
        sync_module.schedule_db = old_db


@pytest.mark.asyncio
async def test_sync_status_precedence_and_aggregation(temp_db):
    """Verify strict priority ordering: ERROR > DRIFT_DETECTED > PENDING > SYNCED."""
    prog = temp_db.create_schedule(
        name="Multi Zone Program",
        weekly_pattern={1: [{"hour": 8, "minute": 0, "drive": "ON"}]},
        assigned_group_ids=[1, 2, 3],
    )
    pid = prog["id"]

    # All 3 SYNCED => program SYNCED
    temp_db.set_sync_status(1, "SYNCED", pid)
    temp_db.set_sync_status(2, "SYNCED", pid)
    temp_db.set_sync_status(3, "SYNCED", pid)
    assert temp_db.get_schedule(pid)["sync_status"] == "SYNCED"

    # One PENDING => program PENDING
    temp_db.set_sync_status(2, "PENDING", pid)
    assert temp_db.get_schedule(pid)["sync_status"] == "PENDING"

    # One DRIFT_DETECTED beats PENDING => program DRIFT_DETECTED
    temp_db.set_sync_status(3, "DRIFT_DETECTED", pid)
    assert temp_db.get_schedule(pid)["sync_status"] == "DRIFT_DETECTED"

    # One ERROR beats DRIFT_DETECTED and PENDING => program ERROR
    temp_db.set_sync_status(1, "ERROR", pid)
    assert temp_db.get_schedule(pid)["sync_status"] == "ERROR"


@pytest.mark.asyncio
async def test_reconstruct_schedules_atomic_abort_on_read_failure(temp_db):
    """Reconstruct must abort atomically without corrupting/wiping DB if reading a group fails."""
    from server.schedule_sync import reconstruct_schedules_from_controller
    from gb50.protocol import GB50ProtocolError
    import server.schedule_sync as sync_module

    old_db = sync_module.schedule_db
    sync_module.schedule_db = temp_db

    try:
        # Create an existing program
        existing = temp_db.create_schedule(
            name="Existing Sanctuary",
            weekly_pattern={1: [{"hour": 9, "minute": 0, "drive": "ON"}]},
            assigned_group_ids=[1],
        )

        mock_client = AsyncMock()
        mock_client.get_all_groups.return_value = [
            GroupStatus(
                group_id=1, name="Zone 1", model=ModelType.IC, address=1,
                slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
                air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
                schedule_enabled=True, filter_dirty=False, error_active=False,
                capabilities=GroupCapabilities(),
            ),
            GroupStatus(
                group_id=2, name="Zone 2", model=ModelType.IC, address=2,
                slave_addresses=[], drive=DriveState.OFF, mode=OperationMode.HEAT,
                air_direction=AirDirection.HORIZONTAL, fan_speed=FanSpeed.AUTO,
                schedule_enabled=True, filter_dirty=False, error_active=False,
                capabilities=GroupCapabilities(),
            ),
        ]

        async def _mock_get_weekly(gid, season=1):
            if gid == 1:
                return {d: [] for d in range(1, 8)}
            raise RuntimeError("Controller connection reset on group 2")

        mock_client.get_weekly_schedule.side_effect = _mock_get_weekly

        with pytest.raises(GB50ProtocolError, match="Failed to read weekly schedule for group 2"):
            await reconstruct_schedules_from_controller(mock_client, force=True)

        # Ensure existing program in SQLite was NOT wiped/corrupted
        programs = temp_db.list_schedules()
        assert len(programs) == 1
        assert programs[0]["name"] == "Existing Sanctuary"
    finally:
        sync_module.schedule_db = old_db


@pytest.mark.asyncio
async def test_merge_and_sync_with_none_drive_and_enums(tmp_path):
    """Verify merging and flashing schedules when drive/mode/fan fields are None or omitted."""
    import server.schedule_sync as sync_module
    from server.schedule_sync import merge_programs_for_group, sync_group_hardware

    db_file = str(tmp_path / "test_schedules_none.db")
    temp_db = ScheduleDatabase(db_path=db_file)
    old_db = sync_module.schedule_db
    sync_module.schedule_db = temp_db

    try:
        # Create program with None drive and enums
        prog = temp_db.create_schedule(
            name="Loose Schema Program",
            weekly_pattern={
                1: [
                    {"hour": 8, "minute": 0, "drive": None, "mode": None, "fan_speed": None, "set_temp_f": 70.0},
                    {"hour": 17, "minute": 0, "drive": "OFF", "mode": None, "fan_speed": None},
                ]
            },
            assigned_group_ids=[1],
        )

        merged, warnings = merge_programs_for_group([prog["id"]])
        assert len(merged[1]) == 2
        assert merged[1][0]["drive"] == "ON"  # Defaulted from None
        assert merged[1][0]["mode"] == "AUTO"  # Defaulted from None
        assert merged[1][1]["drive"] == "OFF"

        mock_client = AsyncMock()
        mock_client.set_weekly_schedule.return_value = True
        mock_client.get_weekly_schedule.return_value = {d: [] for d in range(1, 8)}

        # Flashing should succeed without raising Invalid drive state
        success = await sync_group_hardware(mock_client, group_id=1)
        assert mock_client.set_weekly_schedule.call_count == 7
    finally:
        sync_module.schedule_db = old_db





