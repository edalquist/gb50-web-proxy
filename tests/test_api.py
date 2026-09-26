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
    app.state.client.get_topology = AsyncMock(return_value={})
    
    # Initialize state manager cache
    app.state.state_manager._system_info = mock_system_info
    app.state.state_manager._groups_cache = {1: mock_group}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Unauthenticated Read Endpoints (Must fail with 401)
        resp = await client.get("/api/v1/system")
        assert resp.status_code == 401

        resp = await client.get("/api/v1/groups")
        assert resp.status_code == 401

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

        # 4. Check Current User and Authenticated Read
        me_resp = await client.get("/api/v1/auth/me", headers=admin_headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["username"] == "admin"

        sys_resp = await client.get("/api/v1/system", headers=admin_headers)
        assert sys_resp.status_code == 200
        assert sys_resp.json()["model"] == "GB-50ADA-A"

        # 5. Create a Viewer User (clean up first if already exists from prior test runs)
        existing_users = await client.get("/api/v1/users", headers=admin_headers)
        if existing_users.status_code == 200:
            for u in existing_users.json():
                if u["username"] in ("kiosk_user", "staff_operator"):
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

        # 7. Create and Login as Operator, Test Group Control & Batch Control
        await client.post(
            "/api/v1/users",
            headers=admin_headers,
            json={
                "username": "staff_operator",
                "password": "staffpassword123",
                "role": "operator",
                "display_name": "Facilities Staff",
            },
        )
        staff_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "staff_operator", "password": "staffpassword123"},
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

        # Operator batch controlling groups (verifies /groups/batch is not shadowed)
        s_batch = await client.post(
            "/api/v1/groups/batch",
            headers=staff_headers,
            json={"groups": {1: {"drive": "ON", "mode": "HEAT", "set_temp_f": 70.0}}},
        )
        assert s_batch.status_code == 200

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
        app.state.client.set_system_info = AsyncMock(return_value=True)
        app.state.client.register_option = AsyncMock(return_value=True)

        # Admin updating system info (exercises mgr.refresh_system_info)
        put_sys_resp = await client.put(
            "/api/v1/system",
            headers=admin_headers,
            json={"system_name": "Updated Cathedral"},
        )
        assert put_sys_resp.status_code == 200
        assert put_sys_resp.json()["status"] == "success"

        # Admin registering option license (exercises mgr.refresh_system_info)
        opt_resp = await client.post(
            "/api/v1/options/register",
            headers=admin_headers,
            json={"func_index": 1, "key_code": "1234567890ABCDEF"},
        )
        assert opt_resp.status_code == 200
        assert opt_resp.json()["status"] == "success"

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

        # 9. Clean up test users
        user_list_resp = await client.get("/api/v1/users", headers=admin_headers)
        assert user_list_resp.status_code == 200
        for u in user_list_resp.json():
            if u["username"] in ("kiosk_user", "staff_operator"):
                await client.delete(f"/api/v1/users/{u['id']}", headers=admin_headers)


@pytest.mark.asyncio
async def test_token_revocation_on_password_change_and_disable(mock_system_info, mock_group):
    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    app.state.client.get_system_info = AsyncMock(return_value=mock_system_info)
    app.state.client.get_all_groups = AsyncMock(return_value=[mock_group])

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login as Admin
        admin_login = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        assert admin_login.status_code == 200
        admin_token = admin_login.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Create temporary user
        create_resp = await client.post(
            "/api/v1/users",
            headers=admin_headers,
            json={
                "username": "revoketest_user",
                "password": "initial_password",
                "role": "operator",
                "display_name": "Revoke Test User",
            },
        )
        assert create_resp.status_code == 200
        uid = create_resp.json()["id"]

        # 3. Login as revoketest_user
        u_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "revoketest_user", "password": "initial_password"},
        )
        assert u_login.status_code == 200
        user_token = u_login.json()["access_token"]
        user_headers = {"Authorization": f"Bearer {user_token}"}

        # User token works
        me_resp = await client.get("/api/v1/auth/me", headers=user_headers)
        assert me_resp.status_code == 200

        # 4. Change user password
        ch_resp = await client.post(
            "/api/v1/auth/change-password",
            headers=user_headers,
            json={"old_password": "initial_password", "new_password": "new_password_123"},
        )
        assert ch_resp.status_code == 200

        # 5. Old token must now be rejected (revoked via token_version increment)
        revoked_resp = await client.get("/api/v1/auth/me", headers=user_headers)
        assert revoked_resp.status_code == 401
        assert "Session has been revoked" in revoked_resp.json()["detail"]

        # 6. Login with new password works
        new_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "revoketest_user", "password": "new_password_123"},
        )
        assert new_login.status_code == 200
        new_user_token = new_login.json()["access_token"]
        new_user_headers = {"Authorization": f"Bearer {new_user_token}"}

        # 7. Disable user account
        dis_resp = await client.put(
            f"/api/v1/users/{uid}",
            headers=admin_headers,
            json={"enabled": False},
        )
        assert dis_resp.status_code == 200

        # 8. Token for disabled account must now be rejected
        dis_check = await client.get("/api/v1/auth/me", headers=new_user_headers)
        assert dis_check.status_code == 401

        # Clean up
        await client.delete(f"/api/v1/users/{uid}", headers=admin_headers)


@pytest.mark.asyncio
async def test_mnet_address_collision_rejection(mock_system_info, mock_group):
    """Ensure duplicate M-Net addresses or collisions with existing groups are rejected."""
    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    app.state.client.get_system_info = AsyncMock(return_value=mock_system_info)
    app.state.client.get_all_groups = AsyncMock(return_value=[mock_group])
    app.state.client.get_topology = AsyncMock(return_value={
        1: {"name": "Zone 1", "address": 1, "model": "IC", "slaves": [2], "rcs": [], "floor": 1},
        2: {"name": "Zone 2", "address": 5, "model": "IC", "slaves": [], "rcs": [], "floor": 1},
    })
    app.state.client.set_group_topology = AsyncMock(return_value=True)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        login_resp = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Primary address colliding with existing Group 1 primary
        resp = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={"group_id": 3, "name": "Zone 3", "primary_ic": 1},
        )
        assert resp.status_code == 400
        assert "Primary address 1 is already assigned to Group 1" in resp.json()["detail"]

        # 2. Slave address colliding with existing Group 1 slave
        resp = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={"group_id": 3, "name": "Zone 3", "primary_ic": 10, "slave_ics": [2]},
        )
        assert resp.status_code == 400
        assert "Slave address 2 is already assigned to Group 1" in resp.json()["detail"]

        # 3. Duplicate slave addresses in the request itself
        resp = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={"group_id": 3, "name": "Zone 3", "primary_ic": 10, "slave_ics": [11, 11]},
        )
        assert resp.status_code == 400
        assert "Duplicate addresses specified" in resp.json()["detail"]

        # 4. Primary listed as slave
        resp = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={"group_id": 3, "name": "Zone 3", "primary_ic": 10, "slave_ics": [10]},
        )
        assert resp.status_code == 400
        assert "Primary address 10 cannot also be listed as a slave" in resp.json()["detail"]

        # 5. Non-colliding addresses succeed
        resp = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={"group_id": 3, "name": "Zone 3", "primary_ic": 10, "slave_ics": [11]},
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "success"


@pytest.mark.asyncio
async def test_admin_debug_endpoints(mock_system_info, mock_group):
    """Verify Admin-only raw controller data debug endpoints and safety guards."""
    app = create_app(controller_host="192.0.2.90", poll_interval=60.0)
    app.state.client.get_system_info = AsyncMock(return_value=mock_system_info)
    mock_group.raw_bulk = "010002140000E6040601000000000000001F0000000100010000010000000000000000000000000000000000000000000000000000000000000000000000000000"
    app.state.client.get_all_groups = AsyncMock(return_value=[mock_group])
    
    mock_xml_resp = (
        '<?xml version="1.0" encoding="UTF-8"?>\r\n'
        '<Packet><Command>getResponse</Command><DatabaseManager>'
        '<SystemData Version="2.80" Model="GB-50ADA-A" Number="00000-001" Name="Example Facility" />'
        '<ControlGroup><MnetRecord Group="1" GroupNameWeb="Sanctuary" /><MnetGroupRecord Group="1" Model="IC" Address="1" /></ControlGroup>'
        '<ScheduleControl><TodayList Group="1"><TodayRecord Index="1" Hour="8" Minute="0" Drive="ON" Mode="AUTO" SetTemp="21.5" /></TodayList></ScheduleControl>'
        '</DatabaseManager></Packet>'
    )
    app.state.client._send_xml = AsyncMock(return_value=mock_xml_resp)
    app.state.state_manager._groups_cache = {1: mock_group}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Unauthenticated requests must return 401
        unauth_resp = await client.get("/api/v1/debug/bulk-telemetry")
        assert unauth_resp.status_code == 401

        unauth_query = await client.post("/api/v1/debug/query-xml", json={"query_name": "system_data"})
        assert unauth_query.status_code == 401

        # 2. Login as admin
        login_resp = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        assert login_resp.status_code == 200
        admin_token = login_resp.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 3. GET /debug/bulk-telemetry
        bulk_resp = await client.get("/api/v1/debug/bulk-telemetry", headers=admin_headers)
        assert bulk_resp.status_code == 200
        bulk_data = bulk_resp.json()
        assert bulk_data["count"] >= 1
        group_debug = bulk_data["groups"][0]
        assert group_debug["group_id"] == 1
        assert group_debug["length_bytes"] == 65
        assert len(group_debug["hex_dump"]) == 5  # 65 bytes in 16-byte rows -> 5 rows
        assert len(group_debug["byte_annotations"]) == 65
        assert group_debug["byte_annotations"][0]["field"] == "Packet Frame Header"
        assert group_debug["byte_annotations"][1]["field"] == "Operational Drive State"

        # 4. GET /debug/raw-schedule/1
        sched_resp = await client.get("/api/v1/debug/raw-schedule/1?season=1", headers=admin_headers)
        assert sched_resp.status_code == 200
        sched_data = sched_resp.json()
        assert sched_data["group_id"] == 1
        assert "today_request_xml" in sched_data
        assert "today_response_xml" in sched_data
        assert len(sched_data["today_records"]) >= 1
        assert sched_data["today_records"][0]["hour"] == 8

        # 5. GET /debug/raw-topology
        topo_resp = await client.get("/api/v1/debug/raw-topology", headers=admin_headers)
        assert topo_resp.status_code == 200
        topo_data = topo_resp.json()
        assert "request_xml" in topo_data
        assert "response_xml" in topo_data
        assert "topology" in topo_data

        # 6. GET /debug/raw-system
        sys_resp = await client.get("/api/v1/debug/raw-system", headers=admin_headers)
        assert sys_resp.status_code == 200
        sys_data = sys_resp.json()
        assert sys_data["system_info"]["version"] == "2.80"

        # 7. POST /debug/query-xml with safe preset
        query_resp = await client.post(
            "/api/v1/debug/query-xml",
            headers=admin_headers,
            json={"query_name": "system_data"},
        )
        assert query_resp.status_code == 200
        q_data = query_resp.json()
        assert q_data["status"] == "success"
        assert "request_xml" in q_data
        assert "response_xml" in q_data
        assert q_data["duration_ms"] >= 0

        # 8. POST /debug/query-xml Safety Guard: Mutating command must be rejected with 400
        unsafe_resp = await client.post(
            "/api/v1/debug/query-xml",
            headers=admin_headers,
            json={"custom_xml": "<Packet><Command>setRequest</Command><DatabaseManager><ControlGroup /></DatabaseManager></Packet>"},
        )
        assert unsafe_resp.status_code == 400
        assert "Safety Guard" in unsafe_resp.json()["detail"]


@pytest.mark.asyncio
async def test_kiosk_auto_login():
    """Verify kiosk auto-login endpoint under various configuration states."""
    import os
    app = create_app()
    transport = httpx.ASGITransport(app=app)

    # 1. When disabled (default) -> 404
    os.environ["GB50_KIOSK_AUTO_LOGIN"] = "disabled"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/auth/kiosk-session")
        assert resp.status_code == 404

    # 2. When enabled with viewer role -> 200 and role == "viewer"
    os.environ["GB50_KIOSK_AUTO_LOGIN"] = "viewer"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/auth/kiosk-session")
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["role"] == "viewer"
        assert data["user"]["username"] == "kiosk"

    # 3. When enabled with operator role -> 200 and role == "operator"
    os.environ["GB50_KIOSK_AUTO_LOGIN"] = "operator"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/auth/kiosk-session")
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["role"] == "operator"

    # Cleanup
    os.environ["GB50_KIOSK_AUTO_LOGIN"] = "disabled"



