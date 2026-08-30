"""Unit and integration tests for FastAPI REST API and Web UI static serving."""

import pytest
import httpx
from datetime import datetime
from unittest.mock import AsyncMock

from server.app import create_app
from gb50.models import SystemInfo, GroupStatus, GroupCapabilities, AlarmRecord
from gb50.constants import DriveState, OperationMode, AirDirection, FanSpeed, ModelType


@pytest.fixture
def mock_system_info():
    return SystemInfo(
        version="2.80",
        model="GB-50ADA-A",
        serial_number="00000-001",
        system_name="Example Facility",
        location_id="000001",
        ip_address="192.0.2.90",
        subnet_mask="255.255.255.0",
        gateway="192.0.2.1",
        mac_address="020000000001",
        mnet_address=0,
        temp_unit="F",
        licensed_functions={"WebBrowse": True, "Schedule": True},
    )


@pytest.fixture
def mock_group():
    return GroupStatus(
        group_id=1,
        name="FC1-1",
        model=ModelType.IC,
        address=1,
        slave_addresses=[],
        drive=DriveState.OFF,
        mode=OperationMode.HEAT,
        set_temp_c=20.0,
        inlet_temp_c=23.0,
        air_direction=AirDirection.HORIZONTAL,
        fan_speed=FanSpeed.AUTO,
        schedule_enabled=True,
        filter_dirty=False,
        error_active=False,
        capabilities=GroupCapabilities(),
    )


@pytest.mark.asyncio
async def test_rest_api_endpoints(mock_system_info, mock_group):
    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    
    # Mock client methods
    app.state.client.get_system_info = AsyncMock(return_value=mock_system_info)
    app.state.client.get_all_groups = AsyncMock(return_value=[mock_group])
    app.state.client.get_groups_telemetry = AsyncMock(return_value=[mock_group])
    app.state.client.get_group = AsyncMock(return_value=mock_group)
    app.state.client.set_group = AsyncMock(return_value=True)
    app.state.client.set_groups_batch = AsyncMock(return_value=True)
    app.state.client.set_group_name = AsyncMock(return_value=True)
    app.state.client.reset_filter = AsyncMock(return_value=True)
    app.state.client.get_alarms = AsyncMock(return_value=[AlarmRecord(index=1, address=1, error_code="0000", unit_model="IC", priority_level=2, message="Normal")])
    app.state.client.get_datetime = AsyncMock(return_value=datetime(2026, 8, 29, 22, 0, 0))
    app.state.client.set_datetime = AsyncMock(return_value=True)
    
    # Initialize state manager cache
    app.state.state_manager._system_info = mock_system_info
    app.state.state_manager._groups_cache = {1: mock_group}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. System Info
        resp = await client.get("/api/v1/system")
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "GB-50ADA-A"
        assert data["system_name"] == "Example Facility"

        # 2. All Groups
        resp = await client.get("/api/v1/groups")
        assert resp.status_code == 200
        groups = resp.json()
        assert len(groups) == 1
        assert groups[0]["name"] == "FC1-1"
        assert groups[0]["set_temp_f"] == 68.0
        assert groups[0]["inlet_temp_f"] == 73.4

        # 3. Single Group
        resp = await client.get("/api/v1/groups/1")
        assert resp.status_code == 200
        assert resp.json()["group_id"] == 1

        # 4. Control Group
        resp = await client.post(
            "/api/v1/groups/1",
            json={"drive": "ON", "mode": "COOL", "set_temp_f": 72.0},
        )
        assert resp.status_code == 200
        app.state.client.set_group.assert_called_once()

        # 5. Rename Group
        resp = await client.put(
            "/api/v1/groups/1/name",
            json={"name": "Sanctuary East"},
        )
        assert resp.status_code == 200

        # 6. Apply Preset (Sunday Service)
        resp = await client.post("/api/v1/presets/sunday")
        assert resp.status_code == 200
        app.state.client.set_groups_batch.assert_called()

        # 7. Reset Filter
        resp = await client.post("/api/v1/groups/1/reset-filter")
        assert resp.status_code == 200
        app.state.client.reset_filter.assert_called_once_with(1)

        # 8. Alarms
        resp = await client.get("/api/v1/alarms")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        # 9. Clock
        resp = await client.get("/api/v1/clock")
        assert resp.status_code == 200
        assert "2026-08-29" in resp.json()["current_time"]

        # 10. Web UI Static Root Serving
        resp = await client.get("/")
        assert resp.status_code == 200
        assert "Example Facility HVAC Control" in resp.text
