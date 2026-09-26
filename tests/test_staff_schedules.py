"""Unit and integration tests for staff schedule compilation, zone metadata, and season reconciliation."""

import pytest
import os
import tempfile
from server.schedule_db import (
    ScheduleDatabase,
    parse_time_str,
    compile_staff_schedule_pattern,
)


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = ScheduleDatabase(db_path=path)
    yield db
    if os.path.exists(path):
        os.remove(path)


def test_parse_time_str():
    """Verify 12h and 24h time string parsing."""
    assert parse_time_str("07:30") == (7, 30)
    assert parse_time_str("7:30 AM") == (7, 30)
    assert parse_time_str("1:00 PM") == (13, 0)
    assert parse_time_str("12:00 PM") == (12, 0)
    assert parse_time_str("12:00 AM") == (0, 0)
    assert parse_time_str("11:45 PM") == (23, 45)
    assert parse_time_str("8:15") == (8, 15)


def test_compile_staff_schedule_pattern():
    """Verify deterministic compilation of occupied interval to paired ON/OFF events."""
    pattern = compile_staff_schedule_pattern(
        days=[7],  # Sunday
        occupied_start="7:30 AM",
        occupied_end="1:00 PM",
        temperature_f=70.0,
        mode="AUTO",
        thermostat_adjustments_allowed=True,
    )

    assert len(pattern[7]) == 2
    ev_on, ev_off = pattern[7][0], pattern[7][1]

    # ON event
    assert ev_on["hour"] == 7
    assert ev_on["minute"] == 30
    assert ev_on["drive"] == "ON"
    assert ev_on["mode"] == "AUTO"
    assert ev_on["set_temp_f"] == 70.0
    assert ev_on["set_temp_c"] == 21.0
    assert ev_on["remote_lock"] == "PERMIT"

    # OFF event
    assert ev_off["hour"] == 13
    assert ev_off["minute"] == 0
    assert ev_off["drive"] == "OFF"
    assert ev_off["mode"] == "AUTO"
    assert ev_off["remote_lock"] == "PERMIT"

    # Other days should be empty
    for d in range(1, 7):
        assert pattern[d] == []


def test_compile_staff_schedule_pattern_locked_thermostat():
    """Verify thermostat lockout is respected when disabled."""
    pattern = compile_staff_schedule_pattern(
        days=[1, 2, 3, 4, 5],
        occupied_start="08:00",
        occupied_end="17:00",
        temperature_f=72.0,
        mode="COOL",
        thermostat_adjustments_allowed=False,
    )
    for d in range(1, 6):
        assert len(pattern[d]) == 2
        assert pattern[d][0]["remote_lock"] == "PROHIBIT"
        assert pattern[d][1]["remote_lock"] == "PROHIBIT"
        assert pattern[d][0]["mode"] == "COOL"


def test_zone_metadata_crud(temp_db):
    """Verify zone room names and area groupings persistence."""
    assert temp_db.get_all_zone_metadata() == {}

    temp_db.upsert_zone_metadata(1, "Sanctuary", "Floor 1")
    temp_db.upsert_zone_metadata(2, "Fellowship Hall", "Floor 1")
    temp_db.upsert_zone_metadata(15, "Choir Room", "Floor 2")

    meta = temp_db.get_all_zone_metadata()
    assert meta[1] == {"room_name": "Sanctuary", "area_name": "Floor 1"}
    assert meta[2] == {"room_name": "Fellowship Hall", "area_name": "Floor 1"}
    assert meta[15] == {"room_name": "Choir Room", "area_name": "Floor 2"}

    # Update zone 1
    temp_db.upsert_zone_metadata(1, "Main Sanctuary", "East Wing")
    meta2 = temp_db.get_all_zone_metadata()
    assert meta2[1] == {"room_name": "Main Sanctuary", "area_name": "East Wing"}


def test_staff_schedule_persistence(temp_db):
    """Verify staff schedule metadata persistence and retrieval."""
    pattern = compile_staff_schedule_pattern(
        days=[7],
        occupied_start="07:30",
        occupied_end="13:00",
        temperature_f=70.0,
    )
    meta = {
        "occupied_start": "07:30",
        "occupied_end": "13:00",
        "temperature_f": 70.0,
        "mode": "AUTO",
        "thermostat_adjustments_allowed": True,
        "days": [7],
        "status": "draft",
    }
    prog = temp_db.create_schedule(
        name="Sunday Worship",
        description="Occupied 07:30 - 13:00 at 70°F",
        weekly_pattern=pattern,
        assigned_group_ids=[1, 2],
        season_id=1,
        metadata_json=meta,
    )

    assert prog["name"] == "Sunday Worship"
    assert prog["metadata_json"]["status"] == "draft"
    assert prog["metadata_json"]["occupied_start"] == "07:30"
    assert prog["assigned_group_ids"] == [1, 2]

    # Retrieve from DB
    loaded = temp_db.get_schedule(prog["id"])
    assert loaded is not None
    assert loaded["metadata_json"]["temperature_f"] == 70.0
    assert loaded["assigned_group_ids"] == [1, 2]


def test_season_reconciliation_matching(temp_db):
    """Verify season comparison when hardware and DB seasons match."""
    class MockHWSeason:
        def __init__(self, season, sm, sd, em, ed):
            self.season = season
            self.start_month = sm
            self.start_day = sd
            self.end_month = em
            self.end_day = ed

    matching_hw = [
        MockHWSeason(1, 4, 1, 9, 30),
        MockHWSeason(2, 10, 1, 3, 31),
        MockHWSeason(3, 0, 0, 0, 0),
        MockHWSeason(4, 0, 0, 0, 0),
        MockHWSeason(5, 0, 0, 0, 0),
    ]

    res = temp_db.compare_seasons(matching_hw)
    assert res["reconciled"] is True
    assert len(res["mismatches"]) == 0


def test_season_reconciliation_mismatch(temp_db):
    """Verify season comparison detects discrepancies between hardware and DB."""
    class MockHWSeason:
        def __init__(self, season, sm, sd, em, ed):
            self.season = season
            self.start_month = sm
            self.start_day = sd
            self.end_month = em
            self.end_day = ed

    mismatch_hw = [
        MockHWSeason(1, 0, 0, 0, 0),
        MockHWSeason(2, 10, 1, 3, 31),
        MockHWSeason(3, 0, 0, 0, 0),
        MockHWSeason(4, 0, 0, 0, 0),
        MockHWSeason(5, 0, 0, 0, 0),
    ]

    res = temp_db.compare_seasons(mismatch_hw)
    assert res["reconciled"] is False
    assert len(res["mismatches"]) == 1
    assert res["mismatches"][0]["season_id"] == 1
    assert res["mismatches"][0]["controller"]["start_month"] == 0
    assert res["mismatches"][0]["db"]["start_month"] == 4


def test_assign_groups_to_schedule_alias(temp_db):
    """Verify assign_groups_to_schedule alias works identically to assign_zones."""
    prog = temp_db.create_schedule(
        name="Test Assign Alias",
        description="Testing alias",
        weekly_pattern={d: [] for d in range(1, 8)},
        assigned_group_ids=[1],
    )
    sched_id = prog["id"]
    assert prog["assigned_group_ids"] == [1]

    # Reassign using alias - returns removed group IDs and tracks in pending syncs
    removed = temp_db.assign_groups_to_schedule(sched_id, [10, 20, 30])
    assert removed == [1]
    assert 1 in temp_db.get_pending_group_syncs()

    loaded = temp_db.get_schedule(sched_id)
    assert loaded["assigned_group_ids"] == [10, 20, 30]


@pytest.mark.asyncio
async def test_staff_schedule_api_put_with_room_ids():
    """Verify PUT /api/v1/schedules/staff/{id} updates room assignments without error."""
    import httpx
    from server.app import create_app

    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Login as admin to get auth token
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create staff schedule
        create_resp = await client.post(
            "/api/v1/schedules/staff",
            headers=headers,
            json={
                "name": "Midweek Choir Rehearsal",
                "room_ids": [1, 2],
                "recurrence_kind": "weekly",
                "days": [4],
                "occupied_start": "18:00",
                "occupied_end": "20:30",
                "temperature_f": 69.0,
                "mode": "AUTO",
                "thermostat_adjustments_allowed": True,
                "auto_publish": False,
                "season_id": 1,
            },
        )
        assert create_resp.status_code == 200
        sched = create_resp.json()
        sched_id = sched["id"]
        assert sched["assigned_group_ids"] == [1, 2]

        # Update staff schedule with changed room_ids
        update_resp = await client.put(
            f"/api/v1/schedules/staff/{sched_id}",
            headers=headers,
            json={
                "name": "Midweek Choir Rehearsal - Extended",
                "room_ids": [3, 4, 5],
                "temperature_f": 71.0,
            },
        )
        assert update_resp.status_code == 200
        updated = update_resp.json()
        assert updated["name"] == "Midweek Choir Rehearsal - Extended"
        assert updated["assigned_group_ids"] == [3, 4, 5]
        assert updated["metadata_json"]["temperature_f"] == 71.0

        # Clean up
        del_resp = await client.delete(f"/api/v1/schedules/programs/{sched_id}", headers=headers)
        assert del_resp.status_code == 200


@pytest.mark.asyncio
async def test_publish_schedule_streaming_progress():
    """Verify POST /api/v1/schedules/{id}/publish?stream=true emits live flashing progress events."""
    import httpx
    import json
    from unittest.mock import AsyncMock
    from server.app import create_app
    from server.schedule_db import schedule_db

    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)

    # Mock client methods for publishing and season check
    app.state.client.get_seasons = AsyncMock(return_value=[])
    app.state.client.set_weekly_schedule = AsyncMock(return_value=True)
    app.state.client.get_weekly_schedule = AsyncMock(return_value={d: [] for d in range(1, 8)})

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Create schedule with 2 rooms
        sched = schedule_db.create_schedule(
            name="Stream Test Schedule",
            description="Testing progress streaming",
            weekly_pattern={d: [] for d in range(1, 8)},
            assigned_group_ids=[1, 2],
            season_id=1,
            season_scope=["1"],
        )
        sched_id = sched["id"]

        try:
            # Stream publish
            events = []
            async with client.stream("POST", f"/api/v1/schedules/{sched_id}/publish?stream=true", headers=headers) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers.get("content-type", "")
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = json.loads(line[6:])
                        events.append(data)

            assert len(events) >= 3  # flashing room 1, success room 1, flashing room 2, success room 2, completed, done
            has_flashing = any(e.get("status") == "flashing" for e in events)
            has_success = any(e.get("status") == "success" for e in events)
            has_done = any(e.get("event") == "done" for e in events)
            assert has_flashing, "Expected at least one flashing status event"
            assert has_success, "Expected at least one success status event"
            assert has_done, "Expected final done event"
        finally:
            schedule_db.delete_schedule(sched_id)


