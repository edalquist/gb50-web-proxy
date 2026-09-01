"""Unit and integration tests for FastAPI REST API, Web UI static serving, and RBAC authentication."""

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
async def test_rest_api_endpoints_and_rbac(mock_system_info, mock_group):
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
        # 1. Unauthenticated Read Endpoints (Allowed)
        resp = await client.get("/api/v1/system")
        assert resp.status_code == 200
        assert resp.json()["model"] == "GB-50ADA-A"

        resp = await client.get("/api/v1/groups")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        # 2. Unauthenticated Control Attempt (Must fail with 401)
        resp = await client.post("/api/v1/groups/1", json={"drive": "ON"})
        assert resp.status_code == 401

        # 3. Authenticate as Admin
        login_resp = await client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        assert login_resp.status_code == 200
        admin_data = login_resp.json()
        assert "access_token" in admin_data
        assert admin_data["user"]["role"] == "admin"
        admin_token = admin_data["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 4. Check Current User
        me_resp = await client.get("/api/v1/auth/me", headers=admin_headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["username"] == "admin"

        # 5. Create a Viewer User (clean up first if already exists from prior test runs)
        existing_users = await client.get("/api/v1/users", headers=admin_headers)
        if existing_users.status_code == 200:
            for u in existing_users.json():
                if u["username"] == "kiosk_user":
                    await client.delete(f"/api/v1/users/{u['id']}", headers=admin_headers)

        create_resp = await client.post(
            "/api/v1/users",
            headers=admin_headers,
            json={
                "username": "kiosk_user",
                "password": "kioskpassword",
                "role": "viewer",
                "display_name": "Narthex Display Kiosk",
            },
        )
        assert create_resp.status_code == 200
        assert create_resp.json()["role"] == "viewer"

        # 6. Login as Viewer and Test Permission Denied (403) on Control
        v_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "kiosk_user", "password": "kioskpassword"},
        )
        assert v_login.status_code == 200
        viewer_token = v_login.json()["access_token"]
        viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

        # Viewer reading groups: Allowed (200)
        v_groups = await client.get("/api/v1/groups", headers=viewer_headers)
        assert v_groups.status_code == 200

        # Viewer trying to control group: Denied (403)
        v_ctrl = await client.post(
            "/api/v1/groups/1",
            headers=viewer_headers,
            json={"drive": "ON"},
        )
        assert v_ctrl.status_code == 403

        # 7. Login as Operator and Test Successful Group Control
        staff_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "staff", "password": "staff123"},
        )
        assert staff_login.status_code == 200
        staff_token = staff_login.json()["access_token"]
        staff_headers = {"Authorization": f"Bearer {staff_token}"}

        # Operator controlling group: Allowed (200)
        s_ctrl = await client.post(
            "/api/v1/groups/1",
            headers=staff_headers,
            json={"drive": "ON", "mode": "COOL", "set_temp_f": 72.0},
        )
        assert s_ctrl.status_code == 200

        # Operator trying to provision new group: Denied (403)
        s_prov = await client.post(
            "/api/v1/groups",
            headers=staff_headers,
            json={"group_id": 31, "name": "Test", "primary_ic": 31},
        )
        assert s_prov.status_code == 403

        # 8. Admin Control Operations
        app.state.client.set_group_topology = AsyncMock(return_value=True)
        app.state.client.delete_group = AsyncMock(return_value=True)

        resp = await client.post(
            "/api/v1/groups",
            headers=admin_headers,
            json={
                "group_id": 31,
                "name": "Youth Sanctuary",
                "primary_ic": 31,
                "model": "IC",
                "slave_ics": [32],
                "floor": 2,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "success"

        # 9. Clean up test user
        user_list_resp = await client.get("/api/v1/users", headers=admin_headers)
        assert user_list_resp.status_code == 200
        kiosk = next((u for u in user_list_resp.json() if u["username"] == "kiosk_user"), None)
        if kiosk:
            del_resp = await client.delete(f"/api/v1/users/{kiosk['id']}", headers=admin_headers)
            assert del_resp.status_code == 200


def test_temperature_snapping_and_database_init():
    from server.routes import ScheduleEventInput
    from server.auth import user_db

    # Test half-degree Celsius snapping
    ev1 = ScheduleEventInput(hour=8, minute=0, drive="ON", set_temp_f=70.0)
    # (70 - 32) * 5 / 9 = 21.111 -> snapped to 21.0
    assert ev1.resolved_temp_c() == 21.0

    ev2 = ScheduleEventInput(hour=8, minute=0, drive="ON", set_temp_f=72.0)
    # (72 - 32) * 5 / 9 = 22.222 -> snapped to 22.0
    assert ev2.resolved_temp_c() == 22.0

    ev3 = ScheduleEventInput(hour=8, minute=0, drive="ON", set_temp_c=21.4)
    # 21.4 -> snapped to 21.5
    assert ev3.resolved_temp_c() == 21.5

    # Test user_db init_db public alias
    user_db.init_db()
    users = user_db.list_users()
    assert len(users) >= 1
    assert any(u["username"] == "admin" for u in users)

