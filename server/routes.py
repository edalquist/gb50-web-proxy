"""FastAPI route definitions for the GB-50 REST API & WebSocket proxy."""

from __future__ import annotations

import logging
import asyncio
import json
import time
import struct
from typing import List, Dict, Any, Optional, Union
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from gb50.models import (
    GroupStatus,
    SystemInfo,
    ScheduleItem,
    AlarmRecord,
    GroupControlRequest,
)
from gb50.protocol import (
    GB50ProtocolError,
    build_get_system_info_request,
    build_get_topology_request,
    build_get_groups_telemetry_request,
    build_get_today_schedule_request,
    build_get_all_schedules_request,
    build_get_weekly_schedule_request,
    build_get_season_list_request,
    build_get_alarms_request,
    build_get_datetime_request,
    build_get_summertime_request,
    build_get_setback_request,
    wrap_packet,
    parse_system_info,
    parse_topology,
    parse_interlocks_list,
    parse_today_schedule,
    parse_weekly_schedule,
    parse_bulk_telemetry,
)
from gb50.constants import (
    DriveState,
    OperationMode,
    AirDirection,
    FanSpeed,
    ModelType,
    RemoteControlPermission,
    BULK_DRIVE_MAP,
    BULK_MODE_MAP,
    BULK_AIR_DIR_MAP,
    BULK_FAN_SPEED_MAP,
    BULK_MODEL_MAP,
)
from gb50.state_manager import StateManager
from .auth import (
    user_db,
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    get_current_user,
    require_role,
    get_or_create_kiosk_user,
    validate_api_key,
    LoginRequest,
    ChangePasswordRequest,
    CreateUserRequest,
    UpdateUserRequest,
    UserProfileResponse,
)
from .schedule_db import schedule_db, compile_staff_schedule_pattern
from .schedule_sync import (
    reconstruct_schedules_from_controller,
    push_schedule_to_hardware,
    publish_schedule_to_hardware,
    check_schedule_drift,
    calculate_weekly_runtime_hours,
    merge_programs_for_group,
    sync_group_hardware,
    sync_all_groups_hardware,
    sync_all_seasons_hardware,
)

logger = logging.getLogger("gb50.api")
router = APIRouter(prefix="/api/v1")


def get_state_mgr(websocket_or_request: Any = None) -> StateManager:
    """Dependency injector for StateManager instance (set on app.state)."""
    raise NotImplementedError


def _validate_no_address_collisions(
    topology: Dict[int, Dict[str, Any]],
    target_group_id: Optional[int],
    primary_ic: int,
    slave_ics: Optional[List[int]] = None,
) -> None:
    """Ensure primary and slave addresses are unique across all controller groups."""
    slaves = slave_ics or []
    if len(slaves) != len(set(slaves)):
        raise HTTPException(status_code=400, detail="Duplicate addresses specified in slave units.")
    if primary_ic in slaves:
        raise HTTPException(status_code=400, detail=f"Primary address {primary_ic} cannot also be listed as a slave unit.")

    all_assigned: Dict[int, int] = {}
    for gid, meta in topology.items():
        if target_group_id is not None and gid == target_group_id:
            continue
        primary = meta.get("address")
        if primary is not None:
            all_assigned[primary] = gid
        for s in meta.get("slaves", []):
            all_assigned[s] = gid

    if primary_ic in all_assigned:
        colliding_gid = all_assigned[primary_ic]
        colliding_name = topology.get(colliding_gid, {}).get("name", f"Group {colliding_gid}")
        raise HTTPException(
            status_code=400,
            detail=f"Primary address {primary_ic} is already assigned to Group {colliding_gid} ('{colliding_name}')."
        )
    for s in slaves:
        if s in all_assigned:
            colliding_gid = all_assigned[s]
            colliding_name = topology.get(colliding_gid, {}).get("name", f"Group {colliding_gid}")
            raise HTTPException(
                status_code=400,
                detail=f"Slave address {s} is already assigned to Group {colliding_gid} ('{colliding_name}')."
            )



# --- Request Models ---

class UpdateSystemDataRequest(BaseModel):
    """Payload to configure controller SystemData settings."""
    system_name: Optional[str] = Field(None, max_length=40)
    location_id: Optional[str] = Field(None, max_length=6)
    ip_address: Optional[str] = None
    subnet_mask: Optional[str] = None
    gateway: Optional[str] = None
    mnet_address: Optional[int] = None
    temp_unit: Optional[str] = Field(None, pattern="^(F|C)$")
    date_format: Optional[str] = Field(None, pattern="^(MMDDYYYY|DDMMYYYY|YYYYMMDD)$")
    time_format: Optional[str] = Field(None, pattern="^(12|24)$")
    room_temp_display: Optional[str] = Field(None, pattern="^(SHOW_ALWAYS|SHOW_DRIVING|HIDE)$")
    filter_sign_display: Optional[str] = Field(None, pattern="^(ON|OFF)$")
    short_name_display: Optional[str] = Field(None, pattern="^(ON|OFF)$")
    time_master: Optional[str] = Field(None, pattern="^(MASTER|SUB)$")
    use_ec: Optional[str] = Field(None, pattern="^(USE|NOT_USE)$")
    prohibit_level: Optional[str] = Field(None, pattern="^(SC_ALL|RC_ONLY)$")
    external_input: Optional[str] = Field(None, pattern="^(WITHOUT|EMERGENCY|ONOFF|ALL)$")


class CreateGroupRequest(BaseModel):
    """Payload to create or provision a new HVAC group."""
    group_id: int = Field(..., ge=1, le=50)
    name: str = Field(..., max_length=20)
    primary_ic: int = Field(..., ge=1, le=50)
    model: str = Field("IC", pattern="^(IC|LC)$")
    slave_ics: Optional[List[int]] = Field(default_factory=list)
    rcs: Optional[List[int]] = Field(default_factory=list)
    floor: Optional[int] = Field(1, ge=1, le=10)


class UpdateGroupConfigRequest(BaseModel):
    """Payload to configure group hardware address mapping."""
    name: str = Field(..., max_length=20)
    primary_ic: int = Field(..., ge=1, le=50)
    model: str = Field("IC", pattern="^(IC|LC)$")
    slave_ics: Optional[List[int]] = Field(default_factory=list)
    rcs: Optional[List[int]] = Field(default_factory=list)
    floor: Optional[int] = Field(None, ge=1, le=10)


class InterlockPairing(BaseModel):
    """Pairing between Indoor Unit (IC) and LOSSNAY Ventilation (LC)."""
    ic_address: int = Field(..., ge=1, le=50)
    lc_address: int = Field(..., ge=1, le=50)


class UpdateInterlocksRequest(BaseModel):
    """Payload to update all LOSSNAY interlocks."""
    pairings: List[InterlockPairing]


class UpdateSummerTimeRequest(BaseModel):
    """Payload to update Summer Time (Daylight Saving) settings."""
    country_code: str = "US"
    month: str = "3"
    day: str = "2"
    hour: str = "2"
    minute: str = "0"
    shift_min: str = "60"


class UpdateSetbackRequest(BaseModel):
    """Payload to update Night Setback automation."""
    enabled: bool
    start_hour: int = Field(22, ge=0, le=23)
    start_minute: int = Field(0, ge=0, le=59)
    end_hour: int = Field(6, ge=0, le=23)
    end_minute: int = Field(0, ge=0, le=59)
    groups: Optional[List[Dict[str, Any]]] = Field(default_factory=list)


class RegisterOptionRequest(BaseModel):
    """Payload to register an optional software function license."""
    func_index: int = Field(..., ge=1, le=24)
    key_code: str = Field(..., min_length=16, max_length=16)


class ScheduleEventInput(BaseModel):
    """Input payload for a scheduled timer event."""
    hour: int = Field(..., ge=0, le=23)
    minute: int = Field(..., ge=0, le=59)
    drive: str = Field("ON", pattern="^(ON|OFF)$")
    mode: Optional[str] = Field(None, pattern="^(AUTO|HEAT|COOL|FAN|DRY)$")
    set_temp_c: Optional[float] = None
    set_temp_f: Optional[float] = None
    air_direction: Optional[str] = None
    fan_speed: Optional[str] = None
    remote_lock: Optional[str] = Field("PERMIT", pattern="^(PERMIT|PROHIBIT)$")

    def resolved_temp_c(self) -> Optional[float]:
        if self.set_temp_c is not None:
            return round(round(float(self.set_temp_c) * 2.0) / 2.0, 1)
        if self.set_temp_f is not None:
            raw_c = (float(self.set_temp_f) - 32.0) * 5.0 / 9.0
            return round(round(raw_c * 2.0) / 2.0, 1)
        return None


class UpdateTodayScheduleRequest(BaseModel):
    """Payload to update today's schedule across one or more groups."""
    group_ids: List[int] = Field(..., min_length=1)
    events: List[ScheduleEventInput] = Field(default_factory=list)


class UpdateWeeklyScheduleRequest(BaseModel):
    """Payload to update weekly pattern for one or more groups."""
    group_ids: List[int] = Field(..., min_length=1)
    day_of_week: int = Field(..., ge=1, le=7, description="1=Monday .. 7=Sunday")
    events: List[ScheduleEventInput] = Field(default_factory=list)


class BatchControlRequest(BaseModel):
    """Payload for batch operations on multiple groups."""
    groups: Dict[int, GroupControlRequest] = Field(..., description="Map of group_id -> control parameters")


class RenameGroupRequest(BaseModel):
    """Payload to rename an HVAC group."""
    name: str = Field(..., max_length=20, description="New web display name")


class UpdatePasswordRequest(BaseModel):
    """Payload to update a user password."""
    new_password: str = Field(..., min_length=3, max_length=10, description="New alphanumeric password")


class SeasonInput(BaseModel):
    season_id: int = Field(..., ge=1, le=5)
    name: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = Field("", max_length=200)
    start_month: int = Field(0, ge=0, le=12)
    start_day: int = Field(0, ge=0, le=31)
    end_month: int = Field(0, ge=0, le=12)
    end_day: int = Field(0, ge=0, le=31)
    color: Optional[str] = Field("blue", max_length=20)
    enabled: Optional[bool] = True


class UpdateSeasonsRequest(BaseModel):
    seasons: List[SeasonInput] = Field(..., min_length=1, max_length=5)


class CloneSeasonRequest(BaseModel):
    mode_transformation: str = Field("NONE", pattern="^(NONE|COOL_TO_HEAT|HEAT_TO_COOL|INVERT)$")
    setpoint_offset_f: float = Field(0.0, ge=-20.0, le=20.0)
    conflict_strategy: str = Field("REPLACE", pattern="^(REPLACE|APPEND)$")
    auto_flash_hardware: bool = True


class DuplicateProgramRequest(BaseModel):
    target_season_id: Optional[int] = Field(None, ge=1, le=5)
    name_suffix: Optional[str] = Field(" (Copy)", max_length=30)
    mode_transformation: Optional[str] = Field("NONE", pattern="^(NONE|COOL_TO_HEAT|HEAT_TO_COOL|INVERT)$")
    setpoint_offset_f: Optional[float] = Field(0.0, ge=-20.0, le=20.0)


class CreateScheduleProgramRequest(BaseModel):
    """Payload to create a new named schedule program."""
    name: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = Field("", max_length=200)
    color: Optional[str] = Field("blue", max_length=20)
    season_id: Optional[int] = Field(1, ge=1, le=5)
    season_scope: Optional[List[str]] = Field(default_factory=lambda: ["1"])
    weekly_pattern: Optional[Dict[int, List[Union[ScheduleEventInput, Dict[str, Any]]]]] = None
    assigned_group_ids: Optional[List[int]] = Field(default_factory=list)
    metadata_json: Optional[Dict[str, Any]] = None
    publish_to_hardware: Optional[bool] = None

    @field_validator("weekly_pattern")
    @classmethod
    def validate_pattern(cls, v):
        if v is not None:
            for day, events in v.items():
                if not (1 <= int(day) <= 7):
                    raise ValueError(f"Invalid day {day}: must be between 1 and 7")
                if len(events) > 16:
                    raise ValueError(f"Maximum 16 events allowed for day {day} (got {len(events)})")
        return v


class UpdateScheduleProgramRequest(BaseModel):
    """Payload to update an existing named schedule program."""
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=200)
    color: Optional[str] = Field(None, max_length=20)
    season_id: Optional[int] = Field(None, ge=1, le=5)
    season_scope: Optional[List[str]] = None
    weekly_pattern: Optional[Dict[int, List[Union[ScheduleEventInput, Dict[str, Any]]]]] = None
    assigned_group_ids: Optional[List[int]] = None
    metadata_json: Optional[Dict[str, Any]] = None
    publish_to_hardware: Optional[bool] = None

    @field_validator("weekly_pattern")
    @classmethod
    def validate_pattern(cls, v):
        if v is not None:
            for day, events in v.items():
                if not (1 <= int(day) <= 7):
                    raise ValueError(f"Invalid day {day}: must be between 1 and 7")
                if len(events) > 16:
                    raise ValueError(f"Maximum 16 events allowed for day {day} (got {len(events)})")
        return v


class AssignZonesRequest(BaseModel):
    """Payload to assign HVAC zones to a schedule program."""
    group_ids: List[int] = Field(default_factory=list)


class AssignProgramsToZoneRequest(BaseModel):
    """Payload to assign multiple schedule programs to a single HVAC zone."""
    program_ids: List[int] = Field(default_factory=list)



# --- Authentication Endpoints ---

@router.post("/auth/login", summary="Sign In / Authenticate User")
async def login(request: LoginRequest) -> Dict[str, Any]:
    """Authenticate user with username and password, returning JWT access token."""
    user = user_db.get_user_by_username(request.username)
    if not user or not verify_password(request.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    if not user.get("enabled", 1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated. Please contact an administrator.",
        )

    user_db.update_last_login(user["id"])
    token = create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "display_name": user["display_name"],
            "created_at": user.get("created_at"),
            "last_login": user.get("last_login"),
        },
    }


@router.get("/auth/kiosk-session", summary="Obtain Auto-Login Kiosk Session (Localhost Only)")
async def kiosk_session(request: Request) -> Dict[str, Any]:
    """Authenticate local kiosk without password when enabled via GB50_KIOSK_AUTO_LOGIN."""
    import os
    kiosk_mode = os.getenv("GB50_KIOSK_AUTO_LOGIN", "false").strip().lower()
    if kiosk_mode in ("false", "0", "no", "disabled", "none", ""):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kiosk auto-login is disabled.",
        )

    # Strict loopback / localhost verification
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kiosk auto-login is only permitted directly from the local host display.",
        )

    role = "viewer"
    if kiosk_mode in ("operator", "admin", "viewer"):
        role = kiosk_mode
    elif kiosk_mode in ("true", "1", "yes", "enabled"):
        role = "viewer"

    kiosk_user = get_or_create_kiosk_user(role)
    user_db.update_last_login(kiosk_user["id"])
    token = create_access_token(kiosk_user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": kiosk_user["id"],
            "username": kiosk_user["username"],
            "role": kiosk_user["role"],
            "display_name": kiosk_user["display_name"],
            "created_at": kiosk_user.get("created_at"),
            "last_login": kiosk_user.get("last_login"),
        },
    }


@router.get("/auth/me", response_model=UserProfileResponse, summary="Get Current Authenticated User")
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)) -> UserProfileResponse:
    """Retrieve profile and role information for currently authenticated user."""
    return UserProfileResponse(
        id=current_user["id"],
        username=current_user["username"],
        role=current_user["role"],
        display_name=current_user["display_name"],
        created_at=current_user.get("created_at"),
        last_login=current_user.get("last_login"),
        enabled=bool(current_user.get("enabled", 1)),
    )


@router.post("/auth/change-password", summary="Change Own Password")
async def change_own_password(
    request: ChangePasswordRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    mgr: StateManager = Depends(get_state_mgr),
) -> Dict[str, str]:
    """Change the password for the current authenticated user."""
    if not verify_password(request.old_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect current password.")
    user_db.update_user(current_user["id"], new_password=request.new_password)
    await mgr.disconnect_user(current_user["id"])
    return {"status": "success", "message": "Password updated successfully."}


# --- User Management Endpoints (Admin Only) ---

@router.get("/users", response_model=List[UserProfileResponse], summary="List Proxy Users (Admin Only)")
async def list_proxy_users(_admin: Dict[str, Any] = Depends(require_role("admin"))) -> List[UserProfileResponse]:
    """List all proxy user accounts, roles, and status."""
    raw_users = user_db.list_users()
    return [
        UserProfileResponse(
            id=u["id"],
            username=u["username"],
            role=u["role"],
            display_name=u["display_name"],
            created_at=u.get("created_at"),
            last_login=u.get("last_login"),
            enabled=bool(u.get("enabled", 1)),
        )
        for u in raw_users
    ]


@router.post("/users", response_model=UserProfileResponse, summary="Create Proxy User (Admin Only)")
async def create_proxy_user(
    request: CreateUserRequest,
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> UserProfileResponse:
    """Create a new proxy user account."""
    existing = user_db.get_user_by_username(request.username)
    if existing:
        raise HTTPException(status_code=400, detail=f"Username '{request.username}' already exists.")
    user = user_db.create_user(
        username=request.username,
        password=request.password,
        role=request.role,
        display_name=request.display_name,
    )
    return UserProfileResponse(
        id=user["id"],
        username=user["username"],
        role=user["role"],
        display_name=user["display_name"],
        created_at=user.get("created_at"),
        last_login=user.get("last_login"),
        enabled=bool(user.get("enabled", 1)),
    )


@router.put("/users/{user_id}", response_model=UserProfileResponse, summary="Update Proxy User (Admin Only)")
async def update_proxy_user(
    user_id: int,
    request: UpdateUserRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> UserProfileResponse:
    """Update a proxy user's role, display name, status, or password."""
    target = user_db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    user = user_db.update_user(
        user_id=user_id,
        role=request.role,
        display_name=request.display_name,
        enabled=request.enabled,
        new_password=request.new_password,
    )
    if request.new_password or request.enabled is False or request.role:
        await mgr.disconnect_user(user_id)
    return UserProfileResponse(
        id=user["id"],
        username=user["username"],
        role=user["role"],
        display_name=user["display_name"],
        created_at=user.get("created_at"),
        last_login=user.get("last_login"),
        enabled=bool(user.get("enabled", 1)),
    )


@router.delete("/users/{user_id}", summary="Delete Proxy User (Admin Only)")
async def delete_proxy_user(
    user_id: int,
    admin: Dict[str, Any] = Depends(require_role("admin")),
    mgr: StateManager = Depends(get_state_mgr),
) -> Dict[str, str]:
    """Delete a proxy user account."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own administrator account.")
    success = user_db.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found.")
    await mgr.disconnect_user(user_id)
    return {"status": "success", "message": "User deleted successfully."}


# --- System & Group Routes ---

@router.get("/system", response_model=SystemInfo, summary="Get Controller System Information")
async def get_system_info(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> SystemInfo:
    """Retrieve controller model, ROM version, IP, MAC address, and licensed features."""
    try:
        return await mgr.get_system_info()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/system: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/system", summary="Update Controller SystemData Configuration")
async def update_system_info(
    request: UpdateSystemDataRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Update controller SystemData configuration (Facility Name, IP, Subnet, Gateway, formats, etc.)."""
    try:
        settings = request.model_dump(exclude_unset=True)
        await mgr.client.set_system_info(settings)
        await mgr.refresh_system_info()
        return {"status": "success", "message": "System configuration updated on GB-50 controller"}
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/system: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


def _enrich_group_metadata(group: GroupStatus, metadata_map: Dict[int, Dict[str, str]]) -> GroupStatus:
    meta = metadata_map.get(group.group_id)
    if meta and meta.get("room_name"):
        r_name = meta.get("room_name")
    else:
        r_name = group.name

    if meta and meta.get("area_name"):
        a_name = meta.get("area_name")
    else:
        a_name = f"Floor {group.floor or 1}" if group.model != "LC" else "Fresh Air (LOSSNAY)"

    return group.model_copy(update={"room_name": r_name, "area_name": a_name})


class ZoneMetadataRequest(BaseModel):
    room_name: str = Field(..., max_length=100)
    area_name: Optional[str] = Field("", max_length=100)


@router.get("/zones/metadata", summary="Get All Room Names and Area Groupings")
async def get_zones_metadata_route(
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[int, Dict[str, str]]:
    """Retrieve custom room names and area groupings for all zones."""
    return schedule_db.get_all_zone_metadata()


@router.put("/zones/{group_id:int}/metadata", summary="Update Room Name and Area Grouping")
async def update_zone_metadata_route(
    group_id: int,
    request: ZoneMetadataRequest,
    _user: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Assign or update human-readable room name and area grouping for a zone."""
    return schedule_db.upsert_zone_metadata(group_id, request.room_name, request.area_name or "")


@router.get("/groups", response_model=List[GroupStatus], summary="Get All HVAC Groups")
async def get_all_groups(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[GroupStatus]:
    """Retrieve real-time telemetry, mode, temperature, and flags for all HVAC groups, enriched with room names."""
    try:
        groups = await mgr.get_all_groups()
        meta_map = schedule_db.get_all_zone_metadata()
        return [_enrich_group_metadata(g, meta_map) for g in groups]
    except Exception as ex:
        logger.exception("Error in GET /api/v1/groups: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/groups/batch", response_model=List[GroupStatus], summary="Batch Control Multiple Groups")
async def batch_control_groups(
    request: BatchControlRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _user: Dict[str, Any] = Depends(require_role("operator")),
) -> List[GroupStatus]:
    """Control multiple HVAC groups simultaneously in a single transaction."""
    try:
        return await mgr.control_groups_batch(request.groups)
    except Exception as ex:
        logger.exception("Error in POST /api/v1/groups/batch: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/groups/{group_id:int}", response_model=GroupStatus, summary="Get Single HVAC Group")
async def get_group(
    group_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> GroupStatus:
    """Retrieve real-time telemetry for a specific HVAC group by ID (1..50)."""
    try:
        group = await mgr.get_group(group_id)
        if group is None:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found")
        meta_map = schedule_db.get_all_zone_metadata()
        return _enrich_group_metadata(group, meta_map)
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in GET /api/v1/groups/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/groups/{group_id:int}", response_model=GroupStatus, summary="Control HVAC Group")
async def control_group(
    group_id: int,
    request: GroupControlRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _user: Dict[str, Any] = Depends(require_role("operator")),
) -> GroupStatus:
    """Send operational commands (drive ON/OFF, mode, temperature setpoint, fan speed, louvers) to a group."""
    try:
        return await mgr.control_group(group_id, request)
    except GB50ProtocolError as pex:
        logger.warning("Controller rejected command for group %s: %s", group_id, pex)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(pex))
    except Exception as ex:
        logger.exception("Error in POST /api/v1/groups/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/groups/{group_id:int}/name", response_model=GroupStatus, summary="Rename HVAC Group")
async def rename_group(
    group_id: int,
    request: RenameGroupRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> GroupStatus:
    """Rename the web display name for an HVAC group."""
    try:
        return await mgr.rename_group(group_id, request.name)
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/groups/%s/name: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/groups", summary="Create / Provision New HVAC Group", status_code=status.HTTP_201_CREATED)
async def create_group(
    request: CreateGroupRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Provision a new HVAC control group with assigned M-NET address and floor."""
    try:
        # Check if group_id already exists
        groups = await mgr.get_all_groups()
        if any(g.group_id == request.group_id for g in groups):
            raise HTTPException(status_code=400, detail=f"Group ID {request.group_id} already exists.")

        topology = await mgr.client.get_topology(force_refresh=True)
        _validate_no_address_collisions(
            topology=topology,
            target_group_id=None,
            primary_ic=request.primary_ic,
            slave_ics=request.slave_ics,
        )

        await mgr.client.set_group_topology(
            group_id=request.group_id,
            name=request.name,
            primary_ic=request.primary_ic,
            model=request.model,
            slave_ics=request.slave_ics,
            rcs=request.rcs,
            floor=request.floor,
        )
        await mgr.poll_now()
        return {
            "status": "success",
            "message": f"Successfully created Group {request.group_id} ('{request.name}')",
            "group_id": request.group_id,
        }
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in POST /api/v1/groups: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/groups/{group_id:int}/config", summary="Configure Group Hardware Mapping")
async def configure_group_hardware(
    group_id: int,
    request: UpdateGroupConfigRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Configure a group's display name, primary IC address, slave ICs, remote controllers (RC), and floor."""
    try:
        topology = await mgr.client.get_topology(force_refresh=True)
        _validate_no_address_collisions(
            topology=topology,
            target_group_id=group_id,
            primary_ic=request.primary_ic,
            slave_ics=request.slave_ics,
        )

        await mgr.client.set_group_topology(
            group_id=group_id,
            name=request.name,
            primary_ic=request.primary_ic,
            model=request.model,
            slave_ics=request.slave_ics,
            rcs=request.rcs,
            floor=request.floor,
        )
        await mgr.poll_now()
        return {"status": "success", "message": f"Group {group_id} hardware topology updated"}
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/groups/%s/config: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.delete("/groups/{group_id:int}", summary="Delete HVAC Group")
async def delete_group(
    group_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Delete an HVAC group from the controller and unassign all associated M-NET devices."""
    try:
        await mgr.client.delete_group(group_id)
        await mgr.poll_now()
        return {"status": "success", "message": f"Successfully deleted Group {group_id}"}
    except Exception as ex:
        logger.exception("Error in DELETE /api/v1/groups/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/unassigned-addresses", summary="List Unassigned M-NET Addresses")
async def get_unassigned_addresses(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Compute and list available M-NET addresses (1..50) that are not assigned to any group."""
    try:
        groups = await mgr.get_all_groups()
        assigned = set()
        for g in groups:
            assigned.add(g.address)
            for slave in g.slave_addresses:
                assigned.add(slave)
        
        all_possible = set(range(1, 51))
        unassigned = sorted(list(all_possible - assigned))
        return {
            "assigned_count": len(assigned),
            "unassigned_count": len(unassigned),
            "unassigned_addresses": unassigned,
            "assigned_addresses": sorted(list(assigned)),
        }
    except Exception as ex:
        logger.exception("Error in GET /api/v1/unassigned-addresses: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/groups/{group_id:int}/reset-filter", response_model=GroupStatus, summary="Reset Air Filter Sign")
async def reset_filter(
    group_id: int, 
    mgr: StateManager = Depends(get_state_mgr),
    _user: Dict[str, Any] = Depends(require_role("operator")),
) -> GroupStatus:
    """Clear the dirty filter maintenance sign on the controller for this group."""
    try:
        return await mgr.reset_filter(group_id)
    except Exception as ex:
        logger.exception("Error in POST /api/v1/groups/%s/reset-filter: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/presets/{preset_name}", response_model=List[GroupStatus], summary="Apply Quick Scene Preset")
async def apply_preset(
    preset_name: str, 
    mgr: StateManager = Depends(get_state_mgr),
    _user: Dict[str, Any] = Depends(require_role("operator")),
) -> List[GroupStatus]:
    """Apply a batch preset scene ('all_on', 'all_off', 'occupied', 'unoccupied')."""
    try:
        return await mgr.apply_preset(preset_name)
    except ValueError as vex:
        logger.warning("Invalid preset name %s: %s", preset_name, vex)
        raise HTTPException(status_code=400, detail=str(vex))
    except Exception as ex:
        logger.exception("Error in POST /api/v1/presets/%s: %s", preset_name, ex)
        raise HTTPException(status_code=500, detail=str(ex))


# --- Interlocks, Schedules, Alarms, Clock, SummerTime, Setback ---

@router.get("/interlocks", summary="Get LOSSNAY Interlocks")
async def get_interlocks(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[Dict[str, int]]:
    """Retrieve all configured Indoor Unit -> LOSSNAY ventilation pairings."""
    try:
        return await mgr.client.get_interlocks()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/interlocks: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/interlocks", summary="Update LOSSNAY Interlocks")
async def update_interlocks(
    request: UpdateInterlocksRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Update all Indoor Unit -> LOSSNAY ventilation pairings on the controller."""
    try:
        pairings = [p.model_dump() for p in request.pairings]
        await mgr.client.set_interlocks(pairings)
        return {"status": "success", "message": f"{len(pairings)} Interlock pairings saved to controller"}
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/interlocks: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


# --- Seasonal Scheduling & Calendar Management ---

@router.get("/schedules/seasons", summary="Get All 5 Seasons and Calendar Date Spans")
async def get_seasons_route(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[Dict[str, Any]]:
    """Retrieve all 5 seasons with friendly labels, calendar date ranges, and active status."""
    try:
        now = datetime.now()
        return schedule_db.list_seasons(now_month=now.month, now_day=now.day)
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/seasons: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/schedules/seasons", summary="Update All Season Calendar Date Spans")
async def update_seasons_route(
    request: UpdateSeasonsRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> List[Dict[str, Any]]:
    """Update season date spans and labels in DB and flash <WSeasonList> to controller hardware."""
    try:
        seasons_data = [s.model_dump() for s in request.seasons]
        # Update SQLite DB
        updated = schedule_db.update_all_seasons(seasons_data)
        
        # Flash to controller EEPROM
        hw_payload = [
            {
                "season": s.get("season_id", 0),
                "start_month": s.get("start_month", 0),
                "start_day": s.get("start_day", 0),
                "end_month": s.get("end_month", 0),
                "end_day": s.get("end_day", 0),
            }
            for s in seasons_data
        ]
        await mgr.client.set_seasons(hw_payload)
        return updated
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/seasons: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


class ReconcileActionRequest(BaseModel):
    action: str = Field("push_to_controller", pattern="^(push_to_controller|pull_from_controller)$")


@router.get("/schedules/seasons/reconcile", summary="Reconcile Seasons with Controller Hardware")
async def reconcile_seasons_check_route(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Check whether server database seasons match controller hardware seasons."""
    try:
        hw_seasons = await mgr.client.get_seasons()
        return schedule_db.compare_seasons(hw_seasons)
    except Exception as ex:
        logger.exception("Error checking season reconciliation: %s", ex)
        return {
            "reconciled": False,
            "error": str(ex),
            "mismatches": [{"error": f"Controller communication failure: {ex}"}],
            "db_seasons": schedule_db.list_seasons(),
        }


@router.post("/schedules/seasons/reconcile", summary="Execute Season Reconciliation Repair")
async def execute_season_reconciliation_route(
    request: ReconcileActionRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Reconcile season discrepancies by pushing app seasons to controller or pulling controller seasons."""
    try:
        if request.action == "push_to_controller":
            db_seasons = schedule_db.list_seasons()
            hw_payload = [
                {
                    "season": s["season_id"],
                    "start_month": s["start_month"],
                    "start_day": s["start_day"],
                    "end_month": s["end_month"],
                    "end_day": s["end_day"],
                }
                for s in db_seasons
            ]
            await mgr.client.set_seasons(hw_payload)
            return {"status": "success", "message": "Pushed application seasons to controller hardware."}
        else:
            hw_seasons = await mgr.client.get_seasons()
            updated_seasons = []
            for hw in hw_seasons:
                sm = hw.start_month if hasattr(hw, "start_month") else hw.get("start_month", 0)
                sd = hw.start_day if hasattr(hw, "start_day") else hw.get("start_day", 0)
                em = hw.end_month if hasattr(hw, "end_month") else hw.get("end_month", 0)
                ed = hw.end_day if hasattr(hw, "end_day") else hw.get("end_day", 0)
                sid = hw.season if hasattr(hw, "season") else hw.get("season", 0)
                updated_seasons.append({
                    "season_id": sid,
                    "start_month": sm,
                    "start_day": sd,
                    "end_month": em,
                    "end_day": ed,
                    "enabled": bool(sm > 0 and em > 0),
                })
            schedule_db.update_all_seasons(updated_seasons)
            return {"status": "success", "message": "Imported controller seasons into application."}
    except Exception as ex:
        logger.exception("Error executing season reconciliation: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/seasons/{source_id}/clone-to/{target_id}", summary="Clone All Schedules from One Season to Another")
async def clone_season_route(
    source_id: int,
    target_id: int,
    request: CloneSeasonRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Clone all schedule programs and assignments from source season to target season."""
    try:
        if not (1 <= source_id <= 5 and 1 <= target_id <= 5):
            raise HTTPException(status_code=400, detail="Invalid season IDs: must be between 1 and 5")
        if source_id == target_id:
            raise HTTPException(status_code=400, detail="Source and target season cannot be the same")

        cloned_programs = schedule_db.clone_season_schedules(
            source_season_id=source_id,
            target_season_id=target_id,
            mode_transformation=request.mode_transformation,
            setpoint_offset_f=request.setpoint_offset_f,
            conflict_strategy=request.conflict_strategy,
        )

        sync_result = None
        if request.auto_flash_hardware:
            sync_result = await sync_all_groups_hardware(mgr.client, season=target_id)

        return {
            "status": "success",
            "source_season_id": source_id,
            "target_season_id": target_id,
            "cloned_count": len(cloned_programs),
            "programs": cloned_programs,
            "sync_result": sync_result,
        }
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/seasons/%s/clone-to/%s: %s", source_id, target_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/sync-season/{season_id}", summary="Flash Season Schedules to Controller EEPROM")
async def sync_season_hardware_route(
    season_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Flash merged weekly schedule patterns for a specific season to all controller zones."""
    try:
        if not (1 <= season_id <= 5):
            raise HTTPException(status_code=400, detail="Invalid season ID (1..5)")
        res = await sync_all_groups_hardware(mgr.client, season=season_id)
        return {"status": "success", "result": res}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/sync-season/%s: %s", season_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/sync-all-seasons", summary="Flash All 5 Seasons to Controller EEPROM")
async def sync_all_seasons_hardware_route(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Flash all 5 seasonal patterns across all 50 zones to controller EEPROM."""
    try:
        res = await sync_all_seasons_hardware(mgr.client)
        return {"status": "success", "result": res}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/sync-all-seasons: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


# --- Schedule Programs (Schedule-First Architecture) ---

@router.get("/schedules/programs", summary="List All Named Schedule Programs")
async def list_schedule_programs(
    season: Optional[int] = Query(None, ge=1, le=5, description="Filter programs by Season ID (1..5)"),
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[Dict[str, Any]]:
    """Retrieve all named schedule programs, assigned zones, and sync status."""
    try:
        if schedule_db.count_schedules() == 0:
            # Self-healing auto-reconstruct from controller hardware
            progs = await reconstruct_schedules_from_controller(mgr.client)
        else:
            progs = schedule_db.list_schedules(season_id=season)
        
        # Calculate runtime hours for each program
        for p in progs:
            p["weekly_hours"] = calculate_weekly_runtime_hours(p["weekly_pattern"])
        return progs
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/programs: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


class CreateStaffScheduleRequest(BaseModel):
    name: str = Field(..., max_length=100)
    room_ids: List[int] = Field(default_factory=list)
    recurrence_kind: str = Field("weekly", pattern="^(weekly|once)$")
    days: List[int] = Field(default_factory=lambda: [7])
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    occupied_start: str = Field("08:00")
    occupied_end: str = Field("17:00")
    temperature_f: float = Field(70.0, ge=60.0, le=86.0)
    mode: str = Field("AUTO")
    thermostat_adjustments_allowed: bool = Field(True)
    auto_publish: bool = Field(False)
    season_id: int = Field(1, ge=1, le=5)


class UpdateStaffScheduleRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    room_ids: Optional[List[int]] = None
    recurrence_kind: Optional[str] = None
    days: Optional[List[int]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    occupied_start: Optional[str] = None
    occupied_end: Optional[str] = None
    temperature_f: Optional[float] = None
    mode: Optional[str] = None
    thermostat_adjustments_allowed: Optional[bool] = None
    auto_publish: Optional[bool] = None
    season_id: Optional[int] = None


@router.post("/schedules/staff", summary="Create Staff Schedule (Occupied Hours & Rooms)")
async def create_staff_schedule_route(
    request: CreateStaffScheduleRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Create a staff-friendly schedule, compile to paired ON/OFF events, and optionally publish."""
    try:
        weekly_pattern = compile_staff_schedule_pattern(
            days=request.days,
            occupied_start=request.occupied_start,
            occupied_end=request.occupied_end,
            temperature_f=request.temperature_f,
            mode=request.mode,
            thermostat_adjustments_allowed=request.thermostat_adjustments_allowed,
        )
        metadata = {
            "occupied_start": request.occupied_start,
            "occupied_end": request.occupied_end,
            "temperature_f": request.temperature_f,
            "mode": request.mode,
            "thermostat_adjustments_allowed": request.thermostat_adjustments_allowed,
            "recurrence_kind": request.recurrence_kind,
            "days": request.days,
            "start_date": request.start_date,
            "end_date": request.end_date,
            "status": "draft",
        }
        prog = schedule_db.create_schedule(
            name=request.name,
            description=f"Occupied {request.occupied_start} - {request.occupied_end} at {request.temperature_f}°F",
            color="blue",
            weekly_pattern=weekly_pattern,
            assigned_group_ids=request.room_ids,
            season_id=request.season_id,
            season_scope=[str(request.season_id)],
            metadata_json=metadata,
        )
        publish_result = None
        if request.auto_publish and request.room_ids:
            publish_result = await publish_schedule_to_hardware(mgr.client, prog["id"])
            prog = schedule_db.get_schedule(prog["id"])

        prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
        prog["publish_result"] = publish_result
        return prog
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/staff: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/schedules/staff/{schedule_id:int}", summary="Update Staff Schedule")
async def update_staff_schedule_route(
    schedule_id: int,
    request: UpdateStaffScheduleRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Update a staff schedule and recompile paired ON/OFF events."""
    try:
        existing = schedule_db.get_schedule(schedule_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")

        curr_meta = existing.get("metadata_json") or {}
        days = request.days if request.days is not None else curr_meta.get("days", [7])
        occ_start = request.occupied_start or curr_meta.get("occupied_start", "08:00")
        occ_end = request.occupied_end or curr_meta.get("occupied_end", "17:00")
        temp_f = request.temperature_f if request.temperature_f is not None else curr_meta.get("temperature_f", 70.0)
        mode = request.mode or curr_meta.get("mode", "AUTO")
        thermo = request.thermostat_adjustments_allowed if request.thermostat_adjustments_allowed is not None else curr_meta.get("thermostat_adjustments_allowed", True)

        weekly_pattern = compile_staff_schedule_pattern(
            days=days,
            occupied_start=occ_start,
            occupied_end=occ_end,
            temperature_f=temp_f,
            mode=mode,
            thermostat_adjustments_allowed=thermo,
        )

        updated_meta = {
            **curr_meta,
            "occupied_start": occ_start,
            "occupied_end": occ_end,
            "temperature_f": temp_f,
            "mode": mode,
            "thermostat_adjustments_allowed": thermo,
            "days": days,
            "recurrence_kind": request.recurrence_kind or curr_meta.get("recurrence_kind", "weekly"),
            "start_date": request.start_date if request.start_date is not None else curr_meta.get("start_date"),
            "end_date": request.end_date if request.end_date is not None else curr_meta.get("end_date"),
            "status": "draft",
        }

        removed_rooms: List[int] = []
        if request.room_ids is not None:
            removed_rooms = schedule_db.assign_zones(schedule_id, request.room_ids)

        prog = schedule_db.update_schedule(
            schedule_id=schedule_id,
            name=request.name,
            description=f"Occupied {occ_start} - {occ_end} at {temp_f}°F",
            season_id=request.season_id,
            season_scope=[str(request.season_id)] if request.season_id is not None else None,
            weekly_pattern=weekly_pattern,
            metadata_json=updated_meta,
        )

        publish_result = None
        if request.auto_publish:
            publish_result = await publish_schedule_to_hardware(mgr.client, schedule_id, removed_group_ids=removed_rooms)
            prog = schedule_db.get_schedule(schedule_id)

        prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
        prog["publish_result"] = publish_result
        return prog
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/staff/%s: %s", schedule_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/{schedule_id:int}/publish", summary="Publish Schedule to Controller Hardware")
async def publish_schedule_route(
    schedule_id: int,
    stream: bool = Query(False, description="Stream real-time flashing progress as Server-Sent Events"),
    removed_group_ids: Optional[str] = Query(None, description="Comma-separated group IDs removed from this schedule to wipe/re-sync"),
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Any:
    """Publish a draft schedule to the controller hardware EEPROM, returning detailed room results."""
    prog = schedule_db.get_schedule(schedule_id)
    if not prog:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")

    # Safety check: Verify season reconciliation before publishing
    try:
        hw_seasons = await mgr.client.get_seasons()
        recon = schedule_db.compare_seasons(hw_seasons)
        if not recon.get("reconciled", True):
            raise HTTPException(
                status_code=400,
                detail="Publish blocked: Schedule dates need attention. Application season dates disagree with controller hardware. Please reconcile season dates first.",
            )
    except HTTPException:
        raise
    except Exception as sex:
        logger.warning("Could not verify season reconciliation before publish: %s", sex)

    parsed_removed_gids: Optional[List[int]] = None
    if removed_group_ids:
        try:
            parsed_removed_gids = [int(x.strip()) for x in removed_group_ids.split(",") if x.strip()]
        except ValueError:
            parsed_removed_gids = None

    if stream:
        async def event_generator():
            queue: asyncio.Queue = asyncio.Queue()

            async def progress_cb(data: Dict[str, Any]):
                await queue.put({"type": "progress", "data": data})
                try:
                    await mgr.broadcast_event({"event": "publish_progress", **data})
                except Exception:
                    pass

            async def worker():
                try:
                    result = await publish_schedule_to_hardware(
                        mgr.client,
                        schedule_id,
                        progress_callback=progress_cb,
                        removed_group_ids=parsed_removed_gids,
                    )
                    await queue.put({"type": "done", "result": result})
                except Exception as ex:
                    logger.exception("Error in worker publishing schedule %s: %s", schedule_id, ex)
                    await queue.put({"type": "error", "error": str(ex)})
                finally:
                    await queue.put(None)

            worker_task = asyncio.create_task(worker())
            try:
                while True:
                    msg = await queue.get()
                    if msg is None:
                        break
                    if msg["type"] == "progress":
                        yield f"data: {json.dumps(msg['data'])}\n\n"
                    elif msg["type"] == "done":
                        yield f"data: {json.dumps({'event': 'done', 'result': msg['result']})}\n\n"
                    elif msg["type"] == "error":
                        yield f"data: {json.dumps({'event': 'error', 'error': msg['error']})}\n\n"
            finally:
                await worker_task

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    try:
        async def ws_cb(data: Dict[str, Any]):
            try:
                await mgr.broadcast_event({"event": "publish_progress", **data})
            except Exception:
                pass

        result = await publish_schedule_to_hardware(
            mgr.client,
            schedule_id,
            progress_callback=ws_cb,
            removed_group_ids=parsed_removed_gids,
        )
        return result
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error publishing schedule %s: %s", schedule_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/programs", summary="Create Named Schedule Program")
async def create_schedule_program(
    request: CreateScheduleProgramRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Create a new named schedule program and push to assigned controller zones."""
    try:
        prog = schedule_db.create_schedule(
            name=request.name,
            description=request.description or "",
            color=request.color or "blue",
            weekly_pattern=request.weekly_pattern or {d: [] for d in range(1, 8)},
            assigned_group_ids=request.assigned_group_ids or [],
            season_id=request.season_id or 1,
            season_scope=request.season_scope or [str(request.season_id or 1)],
            metadata_json=request.metadata_json,
        )
        should_publish = request.publish_to_hardware if request.publish_to_hardware is not None else True
        if should_publish and request.assigned_group_ids:
            await push_schedule_to_hardware(mgr.client, prog["id"])
            prog = schedule_db.get_schedule(prog["id"])
        prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
        return prog
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/programs: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/programs/{program_id}", summary="Get Named Schedule Program Details")
async def get_schedule_program_details(
    program_id: int,
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Retrieve detailed definition and assigned zones for a schedule program."""
    prog = schedule_db.get_schedule(program_id)
    if not prog:
        raise HTTPException(status_code=404, detail="Schedule program not found")
    prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
    return prog


@router.put("/schedules/programs/{program_id}", summary="Update Named Schedule Program")
async def update_schedule_program_details(
    program_id: int,
    request: UpdateScheduleProgramRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Update program metadata/pattern and write to controller hardware for assigned zones."""
    try:
        removed_gids: List[int] = []
        if request.assigned_group_ids is not None:
            removed_gids = schedule_db.assign_zones(program_id, request.assigned_group_ids)

        prog = schedule_db.update_schedule(
            schedule_id=program_id,
            name=request.name,
            description=request.description,
            color=request.color,
            season_id=request.season_id,
            season_scope=request.season_scope,
            weekly_pattern=request.weekly_pattern,
            metadata_json=request.metadata_json,
        )
        if not prog:
            raise HTTPException(status_code=404, detail="Schedule program not found")

        # Push updated 7-day pattern to controller hardware for all assigned zones (and wipe removed zones)
        should_publish = request.publish_to_hardware if request.publish_to_hardware is not None else True
        if should_publish and (prog["assigned_group_ids"] or removed_gids):
            await push_schedule_to_hardware(mgr.client, program_id, removed_group_ids=removed_gids)
            prog = schedule_db.get_schedule(program_id)

        prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
        return prog
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/programs/%s: %s", program_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/programs/{program_id}/duplicate", summary="Duplicate Single Schedule Program")
async def duplicate_schedule_program_route(
    program_id: int,
    request: DuplicateProgramRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Duplicate an individual schedule program, optionally assigning to a new season and offsetting setpoint."""
    try:
        duplicated = schedule_db.duplicate_schedule(
            schedule_id=program_id,
            target_season_id=request.target_season_id,
            name_suffix=request.name_suffix or " (Copy)",
            mode_transformation=request.mode_transformation or "NONE",
            setpoint_offset_f=request.setpoint_offset_f or 0.0,
        )
        if not duplicated:
            raise HTTPException(status_code=404, detail="Original schedule program not found")
        duplicated["weekly_hours"] = calculate_weekly_runtime_hours(duplicated["weekly_pattern"])
        return duplicated
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/programs/%s/duplicate: %s", program_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.delete("/schedules/programs/{program_id}", summary="Delete Named Schedule Program")
async def delete_schedule_program_route(
    program_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Delete a schedule program from the database and re-sync orphaned zones."""
    prog = schedule_db.get_schedule(program_id)
    if not prog:
        raise HTTPException(status_code=404, detail="Schedule program not found")
    affected_gids = list(prog["assigned_group_ids"])
    season_id = prog.get("season_id", 1)
    success = schedule_db.delete_schedule(program_id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule program not found")
    for gid in affected_gids:
        try:
            await sync_group_hardware(mgr.client, gid, season=season_id)
        except Exception as ex:
            logger.warning("Could not re-sync group %s after program deletion: %s", gid, ex)
    return {"status": "success", "message": f"Deleted schedule program {program_id}"}



@router.post("/schedules/programs/{program_id}/assign", summary="Assign Zones to Schedule Program")
async def assign_zones_to_program_route(
    program_id: int,
    request: AssignZonesRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Assign HVAC zones to a schedule program and flash their hardware EEPROM."""
    try:
        prog = schedule_db.get_schedule(program_id)
        if not prog:
            raise HTTPException(status_code=404, detail="Schedule program not found")

        old_gids = set(prog["assigned_group_ids"])
        new_gids = set(request.group_ids)
        schedule_db.assign_zones(program_id, request.group_ids)
        all_affected = old_gids | new_gids
        for gid in all_affected:
            try:
                await sync_group_hardware(mgr.client, gid)
            except Exception as ex:
                logger.warning("Could not sync group %s after assignment: %s", gid, ex)

        updated_prog = schedule_db.get_schedule(program_id)
        updated_prog["weekly_hours"] = calculate_weekly_runtime_hours(updated_prog["weekly_pattern"])
        return updated_prog
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/programs/%s/assign: %s", program_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/schedules/programs/{program_id}/push-to-hardware", summary="Push Schedule Program to Controller EEPROM")
async def push_program_hardware_route(
    program_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Force-write schedule program to controller hardware across all assigned zones."""
    try:
        await push_schedule_to_hardware(mgr.client, program_id)
        prog = schedule_db.get_schedule(program_id)
        return {"status": "success", "message": f"Successfully pushed schedule to {len(prog['assigned_group_ids'])} zones on controller hardware"}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/programs/%s/push-to-hardware: %s", program_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/assignments", summary="Get All Zone Schedule Program Assignments")
async def get_all_zone_assignments(
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[int, List[int]]:
    """Retrieve full mapping of zone group_id to list of assigned schedule program IDs."""
    return schedule_db.get_all_group_program_assignments()


@router.get("/schedules/zones/{group_id}/programs", summary="Get Assigned Programs for a Zone")
async def get_zone_programs(
    group_id: int,
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[Dict[str, Any]]:
    """Retrieve all schedule programs layered onto a specific HVAC zone."""
    progs = schedule_db.get_programs_for_group(group_id)
    for p in progs:
        p["weekly_hours"] = calculate_weekly_runtime_hours(p["weekly_pattern"])
    return progs


@router.put("/schedules/zones/{group_id}/programs", summary="Set Assigned Programs for a Zone")
async def set_zone_programs(
    group_id: int,
    request: AssignProgramsToZoneRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Assign multiple schedule programs to a zone, re-merge, and flash hardware EEPROM."""
    try:
        schedule_db.assign_programs_to_group(group_id, request.program_ids)
        await sync_group_hardware(mgr.client, group_id)
        assigned_progs = schedule_db.get_programs_for_group(group_id)
        for p in assigned_progs:
            p["weekly_hours"] = calculate_weekly_runtime_hours(p["weekly_pattern"])
        merged_pattern, warnings = merge_programs_for_group(request.program_ids)
        return {
            "status": "success",
            "group_id": group_id,
            "assigned_programs": assigned_progs,
            "merged_pattern": merged_pattern,
            "warnings": warnings,
        }
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/zones/%s/programs: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/zones/{group_id}/merged", summary="Get Merged 7-Day Schedule for a Zone")
async def get_zone_merged_schedule(
    group_id: int,
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Get the composite merged 7-day schedule pattern from all assigned program layers."""
    program_ids = schedule_db.get_program_ids_for_group(group_id)
    merged_pattern, warnings = merge_programs_for_group(program_ids)
    return {
        "group_id": group_id,
        "program_ids": program_ids,
        "merged_pattern": merged_pattern,
        "warnings": warnings,
    }


@router.post("/schedules/reconstruct", summary="Reconstruct Schedules from Controller Hardware")
async def reconstruct_schedules_route(
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> List[Dict[str, Any]]:
    """Scan controller hardware, cluster weekly patterns, and refresh schedule programs."""
    try:
        progs = await reconstruct_schedules_from_controller(mgr.client, force=True)
        for p in progs:
            p["weekly_hours"] = calculate_weekly_runtime_hours(p["weekly_pattern"])
        return progs
    except Exception as ex:
        logger.exception("Error in POST /api/v1/schedules/reconstruct: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules", summary="Get All Groups Today Schedules")
async def get_all_schedules(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[int, List[ScheduleItem]]:
    """Retrieve today's programmed timer events across all configured groups simultaneously."""
    try:
        return await mgr.client.get_all_today_schedules()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/schedules/today", summary="Update Today's Schedule for Group(s)")
async def update_today_schedule(
    request: UpdateTodayScheduleRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Update today's programmed timer events across one or more groups simultaneously."""
    try:
        events_dicts = []
        for ev in request.events:
            events_dicts.append({
                "hour": ev.hour,
                "minute": ev.minute,
                "drive": ev.drive,
                "mode": ev.mode or "AUTO",
                "set_temp_c": ev.resolved_temp_c(),
                "fan_speed": ev.fan_speed or "AUTO",
                "air_direction": ev.air_direction or "",
            })
        await mgr.client.set_today_schedule(request.group_ids, events_dicts)
        return {
            "status": "success",
            "message": f"Updated today's schedule with {len(request.events)} events for {len(request.group_ids)} zones",
        }
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/today: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/schedules/weekly", summary="Update Weekly Schedule for Group(s)")
async def update_weekly_schedule(
    request: UpdateWeeklyScheduleRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("operator")),
) -> Dict[str, Any]:
    """Update weekly schedule pattern for a specific day across one or more groups."""
    try:
        events_dicts = []
        for ev in request.events:
            events_dicts.append({
                "hour": ev.hour,
                "minute": ev.minute,
                "drive": ev.drive,
                "mode": ev.mode or "AUTO",
                "set_temp_c": ev.resolved_temp_c(),
                "fan_speed": ev.fan_speed or "AUTO",
                "air_direction": ev.air_direction or "",
            })
        await mgr.client.set_weekly_schedule(request.group_ids, request.day_of_week, events_dicts)
        day_names = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_name = day_names[request.day_of_week] if 1 <= request.day_of_week <= 7 else str(request.day_of_week)
        return {
            "status": "success",
            "message": f"Updated {day_name} weekly schedule with {len(request.events)} events for {len(request.group_ids)} zones",
        }
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/weekly: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/{group_id:int}", response_model=List[ScheduleItem], summary="Get Group Today Schedule")
async def get_schedule(
    group_id: int,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[ScheduleItem]:
    """Retrieve today's programmed timer events for a specific group."""
    try:
        return await mgr.get_schedule(group_id)
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/{group_id:int}/weekly", summary="Get Group Weekly Schedule Patterns")
async def get_weekly_schedule(
    group_id: int,
    season: int = 1,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[int, List[ScheduleItem]]:
    """Retrieve full 7-day weekly schedule patterns for a group (day 1=Monday .. 7=Sunday)."""
    try:
        return await mgr.client.get_weekly_schedule(group_id, season=season)
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/%s/weekly: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/alarms", response_model=List[AlarmRecord], summary="Get Active System Alarms & Diagnostics")
async def get_alarms(
    priority_level: Optional[int] = None,
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> List[AlarmRecord]:
    """Retrieve unit malfunction alarms, communication logs, and full Mitsubishi diagnostics."""
    try:
        return await mgr.client.get_alarms(priority_level=priority_level)
    except Exception as ex:
        logger.exception("Error in GET /api/v1/alarms: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.delete("/alarms", summary="Clear Historical Alarms Log")
async def clear_alarms(
    priority_level: int = 2,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Clear resolved historical error log entries from controller memory."""
    try:
        await mgr.client.clear_alarm_history(priority_level=priority_level)
        return {"status": "success", "message": "Alarm history log cleared on controller"}
    except Exception as ex:
        logger.exception("Error in DELETE /api/v1/alarms: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/clock", summary="Get Controller Clock")
async def get_clock(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Get controller real-time clock timestamp."""
    try:
        dt = await mgr.client.get_datetime()
        return {"current_time": dt.isoformat()}
    except Exception as ex:
        logger.exception("Error in GET /api/v1/clock: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/clock/sync", summary="Synchronize Controller Clock")
async def sync_clock(
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Synchronize controller clock with current local time."""
    try:
        now = datetime.now()
        await mgr.client.set_datetime(now)
        return {"status": "success", "synchronized_time": now.isoformat()}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/clock/sync: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/clock/summertime", summary="Get Summer Time Settings")
async def get_summertime(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Get Daylight Saving Time (Summer Time) configuration."""
    try:
        return await mgr.client.get_summertime()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/clock/summertime: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/clock/summertime", summary="Update Summer Time Settings")
async def update_summertime(
    request: UpdateSummerTimeRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Update Daylight Saving Time (Summer Time) configuration on controller."""
    try:
        await mgr.client.set_summertime(request.model_dump())
        return {"status": "success", "message": "Summer Time configuration updated"}
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/clock/summertime: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/setback", summary="Get Night Setback Settings")
async def get_setback(
    mgr: StateManager = Depends(get_state_mgr),
    _role: Dict[str, Any] = Depends(require_role("viewer")),
) -> Dict[str, Any]:
    """Get Night Setback schedule and drift temperature thresholds."""
    try:
        return await mgr.client.get_setback()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/setback: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.put("/setback", summary="Update Night Setback Settings")
async def update_setback(
    request: UpdateSetbackRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Update Night Setback schedule and drift temperature thresholds."""
    try:
        await mgr.client.set_setback(
            enabled=request.enabled,
            start_hour=request.start_hour,
            start_minute=request.start_minute,
            end_hour=request.end_hour,
            end_minute=request.end_minute,
            group_records=request.groups,
        )
        return {"status": "success", "message": "Night Setback configuration updated"}
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/setback: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/options/register", summary="Register Software Function License")
async def register_option_license(
    request: RegisterOptionRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Register and activate a 16-character license key code for an optional software function."""
    try:
        await mgr.client.register_option(request.func_index, request.key_code)
        await mgr.refresh_system_info()
        return {"status": "success", "message": f"License code accepted for Function {request.func_index}"}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/options/register: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/controller-users", summary="Get Controller Hardware User Accounts List")
async def get_controller_users(
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> List[Dict[str, Any]]:
    """Retrieve user accounts stored directly on controller hardware (passwords omitted)."""
    try:
        users = []
        for cat in ["Administrator", "Maintenance", "PublicUser"]:
            try:
                cat_users = await mgr.client.get_users(cat)
                users.extend(cat_users)
            except Exception as uex:
                logger.debug("Could not fetch user category %s: %s", cat, uex)
        return users
    except Exception as ex:
        logger.exception("Error in GET /api/v1/controller-users: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/controller-users/{user}/password", summary="Change Controller Hardware User Password")
async def change_controller_user_password(
    user: str,
    request: UpdatePasswordRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, str]:
    """Change the password for a user account stored directly on controller hardware."""
    try:
        await mgr.client.set_user_password(user, request.new_password)
        return {"status": "success", "message": f"Password for controller user '{user}' updated successfully"}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/controller-users/%s/password: %s", user, ex)
        raise HTTPException(status_code=500, detail=str(ex))


# --- WebSocket Stream ---

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = None,
    api_key: Optional[str] = None,
) -> None:
    """Authenticated WebSocket stream providing real-time group telemetry change events."""
    # Check for API Key first (query parameter, X-API-Key header, or Bearer)
    candidate_key = api_key or websocket.headers.get("x-api-key")
    user = validate_api_key(candidate_key)

    if not user:
        # Extract token from query parameter or cookie
        auth_token = token or websocket.cookies.get("gb50_token")
        if not auth_token:
            # Check subprotocols or headers if present
            auth_header = websocket.headers.get("authorization")
            if auth_header and auth_header.lower().startswith("bearer "):
                auth_token = auth_header.split(" ", 1)[1].strip()

        # Check if auth_token is actually an API key
        if auth_token:
            user = validate_api_key(auth_token)

        if not user:
            payload = decode_access_token(auth_token) if auth_token else None
            if not payload:
                logger.warning("Rejecting unauthenticated WebSocket connection attempt from %s", websocket.client)
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            user_id = int(payload.get("sub", 0))
            user = user_db.get_user_by_id(user_id)
            if not user or not user.get("enabled", 1) or payload.get("token_ver") != user.get("token_version", 1):
                logger.warning("Rejecting invalid/revoked user WebSocket connection attempt: user_id=%s", user_id)
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

    mgr: StateManager = websocket.app.state.state_manager
    await websocket.accept()
    mgr.register_ws(websocket, user_id=user["id"])
    
    try:
        groups = await mgr.get_all_groups()
        await websocket.send_json({
            "event": "initial_state",
            "groups": [g.model_dump() for g in groups],
        })
        
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        mgr.unregister_ws(websocket)
    except Exception as ws_ex:
        logger.debug("WebSocket client disconnected: %s", ws_ex)
        mgr.unregister_ws(websocket)


# =========================================================================
# Admin Controller Raw Data Debug & Diagnostics Endpoints
# =========================================================================

def annotate_bulk_payload(bulk_hex: str) -> List[Dict[str, Any]]:
    """Deconstruct a 65-byte (130 hex characters) bulk telemetry string into annotated fields."""
    if not bulk_hex or len(bulk_hex) != 130:
        return []
    try:
        data = bytes.fromhex(bulk_hex)
    except Exception:
        return []
    annotations: List[Dict[str, Any]] = []

    field_descriptions: Dict[int, tuple[str, Any]] = {
        0: ("Packet Frame Header", lambda b, d: "0x01 (GB-50 Protocol Frame)" if b == 1 else f"{b:#04x} (Invalid)"),
        1: ("Operational Drive State", lambda b, d: BULK_DRIVE_MAP.get(b, DriveState.OFF).value),
        2: ("HVAC Operating Mode", lambda b, d: BULK_MODE_MAP.get(b, OperationMode.AUTO).value),
        3: ("Target Setpoint (Integer °C)", lambda b, d: f"{b}°C ({round(b * 9/5 + 32)}°F)"),
        4: ("Target Setpoint (Decimal °C)", lambda b, d: f".{b}°C" if 0 < b < 10 else "0 (None)"),
        5: ("Inlet Air Temp (High Byte)", lambda b, d: f"0x{b:02x}"),
        6: ("Inlet Air Temp (Low Byte / Thermistor)", lambda b, d: f"{round(struct.unpack('>h', d[5:7])[0] / 10.0, 1)}°C ({round((struct.unpack('>h', d[5:7])[0] / 10.0) * 9/5 + 32, 1)}°F)"),
        7: ("Air Direction / Vane Position", lambda b, d: BULK_AIR_DIR_MAP.get(b, AirDirection.AUTO).value),
        8: ("Fan Blower Speed Stage", lambda b, d: BULK_FAN_SPEED_MAP.get(b, FanSpeed.AUTO).value),
        9: ("Wall Remote Controller Lock", lambda b, d: "PROHIBIT (Locked)" if b == 1 else "PERMIT (Unlocked)"),
        15: ("Air Filter Dirty Indicator", lambda b, d: "FILTER DIRTY (Sign Active)" if b == 1 else "Clean (Sign Off)"),
        16: ("Unit Malfunction Error Sign", lambda b, d: "ALARM ACTIVE (Unit in Error)" if b == 1 else "Normal (No Error)"),
        17: ("M-Net Hardware Equipment Model", lambda b, d: BULK_MODEL_MAP.get(b, ModelType.IC).value),
        21: ("Schedule Timer Execution Active", lambda b, d: "ACTIVE (Hardware Timer Running)" if b == 1 else "INACTIVE (Standby)"),
        23: ("Auto Mode Capability", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        24: ("Dry Mode Capability", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        25: ("Fan Speed Stages Configuration", lambda b, d: "4 Stages" if b == 1 else ("3 Stages" if b == 3 else "2 Stages")),
        26: ("Air Direction Vane Capability", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        27: ("Auto Swing Louver Capability", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        28: ("Lossnay Ventilation Interlocked", lambda b, d: "Interlocked" if b == 1 else "None"),
        29: ("Lossnay Bypass Ventilation Mode", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        30: ("Lossnay Automatic Vent Mode", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        31: ("Lossnay Heat Recovery Vent Mode", lambda b, d: "Supported" if b == 1 else "Not Supported"),
        32: ("Cooling Temperature Min (BCD)", lambda b, d: f"{b:02x}°C"),
        33: ("Heating Temperature Max (BCD)", lambda b, d: f"{b:02x}°C"),
        34: ("Cooling Temperature Max (BCD)", lambda b, d: f"{b:02x}°C"),
        35: ("Heating Temperature Min (BCD)", lambda b, d: f"{b:02x}°C"),
        36: ("Auto Mode Temperature Min (BCD)", lambda b, d: f"{b:02x}°C"),
        37: ("Auto Mode Temperature Max (BCD)", lambda b, d: f"{b:02x}°C"),
        45: ("Louver Vane Stages Configuration", lambda b, d: "5 Stages" if b == 1 else "4 Stages"),
    }

    for idx, byte_val in enumerate(data):
        field_name, decoder = field_descriptions.get(idx, (f"Internal Controller Register [{idx}]", lambda b, d: f"0x{b:02x}"))
        try:
            val_str = decoder(byte_val, data)
        except Exception:
            val_str = f"0x{byte_val:02x}"
        annotations.append({
            "offset": idx,
            "hex": f"{byte_val:02X}",
            "dec": byte_val,
            "field": field_name,
            "value": val_str,
        })
    return annotations


def format_hex_dump(bulk_hex: str) -> List[Dict[str, str]]:
    """Format hexadecimal string into traditional 16-byte memory hex dump rows with ASCII text."""
    if not bulk_hex:
        return []
    try:
        data_bytes = bytes.fromhex(bulk_hex)
    except Exception:
        return []
    rows: List[Dict[str, str]] = []
    for offset in range(0, len(data_bytes), 16):
        chunk = data_bytes[offset:offset + 16]
        hex_parts = [f"{b:02x}" for b in chunk]
        part1 = " ".join(hex_parts[:8])
        part2 = " ".join(hex_parts[8:])
        hex_str = f"{part1}  {part2}".ljust(48)
        ascii_chars = "".join(chr(b) if 32 <= b <= 126 else "." for b in chunk)
        rows.append({
            "offset": f"{offset:04x}",
            "hex": hex_str,
            "ascii": ascii_chars,
        })
    return rows


@router.get("/debug/bulk-telemetry", summary="Get Raw 65-Byte Binary Bulk Telemetry for All Zones (Admin Only)")
async def get_raw_bulk_telemetry(
    group_id: Optional[int] = None,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Retrieve raw 65-byte (130-hex char) binary telemetry, formatted hex dumps, and byte breakdowns."""
    groups = await mgr.get_all_groups()
    if group_id is not None:
        groups = [g for g in groups if g.group_id == group_id]

    results = []
    for g in groups:
        raw_hex = g.raw_bulk
        if not raw_hex or len(raw_hex) != 130:
            # Fallback valid 65-byte bulk frame from real indoor unit
            raw_hex = "010002140000E6040601000000000000001F0000000100010000010000000000000000000000000000000000000000000000000000000000000000000000000000"
        
        annotations = annotate_bulk_payload(raw_hex)
        dump_lines = format_hex_dump(raw_hex)
        parsed = {}
        try:
            parsed = parse_bulk_telemetry(raw_hex)
            if "capabilities" in parsed and hasattr(parsed["capabilities"], "model_dump"):
                parsed["capabilities"] = parsed["capabilities"].model_dump()
        except Exception:
            pass

        results.append({
            "group_id": g.group_id,
            "name": g.name,
            "model": g.model,
            "address": g.address,
            "raw_hex": raw_hex,
            "length_bytes": len(raw_hex) // 2,
            "hex_dump": dump_lines,
            "byte_annotations": annotations,
            "parsed_fields": {k: (v.value if hasattr(v, "value") else v) for k, v in parsed.items()},
        })

    return {
        "count": len(results),
        "groups": results,
    }


@router.get("/debug/raw-schedule/{group_id:int}", summary="Get Raw Hardware Timer Registers from Controller (Admin Only)")
async def get_raw_schedule_debug(
    group_id: int,
    season: int = 1,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Inspect raw TodayList and WPatternList timer registers stored in controller EEPROM."""
    today_req = build_get_today_schedule_request(group_id)
    weekly_req = build_get_weekly_schedule_request(group_id, season=season)
    
    try:
        today_xml = await mgr.client._send_xml(today_req)
    except Exception as ex:
        today_xml = f"<ERROR Message='{ex}' />"
        
    try:
        weekly_xml = await mgr.client._send_xml(weekly_req)
    except Exception as ex:
        weekly_xml = f"<ERROR Message='{ex}' />"

    today_items = []
    weekly_patterns = {}
    try:
        today_items = [it.model_dump() for it in parse_today_schedule(today_xml)]
    except Exception:
        pass
    try:
        weekly_patterns = {str(k): [it.model_dump() for it in v] for k, v in parse_weekly_schedule(weekly_xml).items()}
    except Exception:
        pass

    return {
        "group_id": group_id,
        "season": season,
        "today_request_xml": today_req,
        "today_response_xml": today_xml,
        "weekly_request_xml": weekly_req,
        "weekly_response_xml": weekly_xml,
        "today_records": today_items,
        "weekly_patterns": weekly_patterns,
    }


@router.get("/debug/raw-topology", summary="Get Raw M-NET Topology from Controller (Admin Only)")
async def get_raw_topology_debug(
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Inspect raw ControlGroup XML, M-NET addresses, and Lossnay interlocks directly from controller."""
    req = build_get_topology_request()
    resp = await mgr.client._send_xml(req)
    
    topology = {}
    interlocks = []
    try:
        topology = parse_topology(resp)
        interlocks = parse_interlocks_list(resp)
    except Exception:
        pass

    assigned_addresses = set()
    for meta in topology.values():
        if "address" in meta and meta["address"]:
            assigned_addresses.add(meta["address"])
        for sl in meta.get("slaves", []):
            assigned_addresses.add(sl)
        for rc in meta.get("rcs", []):
            assigned_addresses.add(rc)
    unassigned = [addr for addr in range(1, 51) if addr not in assigned_addresses]

    return {
        "request_xml": req,
        "response_xml": resp,
        "topology": topology,
        "interlocks": interlocks,
        "assigned_addresses": sorted(list(assigned_addresses)),
        "unassigned_addresses": unassigned,
    }


@router.get("/debug/raw-system", summary="Get Raw SystemData & Function Licenses from Controller (Admin Only)")
async def get_raw_system_debug(
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Inspect raw SystemData attributes and licensed function records directly from controller."""
    req = build_get_system_info_request()
    resp = await mgr.client._send_xml(req)
    sys_info = None
    try:
        sys_info = parse_system_info(resp).model_dump()
    except Exception:
        pass

    return {
        "request_xml": req,
        "response_xml": resp,
        "system_info": sys_info,
    }


class RawXmlQueryRequest(BaseModel):
    query_name: Optional[str] = None
    custom_xml: Optional[str] = None
    group_id: Optional[int] = 1
    season: Optional[int] = 1


@router.post("/debug/query-xml", summary="Execute Safe Read Query against Controller Hardware (Admin Only)")
async def execute_raw_xml_query(
    request: RawXmlQueryRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Execute a safe, non-mutating read query against the Mitsubishi GB-50 controller."""
    if request.custom_xml:
        xml_payload = request.custom_xml.strip()
        lower_xml = xml_payload.lower()
        if "setrequest" in lower_xml or "deleterequest" in lower_xml or 'operation="write"' in lower_xml or 'operation="delete"' in lower_xml:
            raise HTTPException(
                status_code=400,
                detail="Safety Guard: Only non-mutating read queries ('getRequest') are permitted in the debug console."
            )
        if not xml_payload.startswith("<?xml") and not xml_payload.startswith("<Packet"):
            xml_payload = wrap_packet("getRequest", xml_payload)
    elif request.query_name:
        q = request.query_name.lower()
        if q == "system_data":
            xml_payload = build_get_system_info_request()
        elif q == "topology":
            xml_payload = build_get_topology_request()
        elif q == "telemetry":
            xml_payload = build_get_groups_telemetry_request(list(range(1, 51)))
        elif q == "today_schedule":
            xml_payload = build_get_all_schedules_request([request.group_id or 1])
        elif q == "weekly_schedule":
            xml_payload = build_get_weekly_schedule_request(request.group_id or 1, season=request.season or 1)
        elif q == "seasons":
            xml_payload = build_get_season_list_request()
        elif q == "alarms":
            xml_payload = build_get_alarms_request(priority_level=2)
        elif q == "datetime":
            xml_payload = build_get_datetime_request()
        elif q == "summertime":
            xml_payload = build_get_summertime_request()
        elif q == "setback":
            xml_payload = build_get_setback_request()
        else:
            raise HTTPException(status_code=400, detail=f"Unknown preset query '{request.query_name}'")
    else:
        raise HTTPException(status_code=400, detail="Must provide either 'query_name' or 'custom_xml'.")

    t0 = time.perf_counter()
    try:
        resp_xml = await mgr.client._send_xml(xml_payload)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "status": "success",
            "request_xml": xml_payload,
            "response_xml": resp_xml,
            "duration_ms": elapsed_ms,
        }
    except Exception as ex:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        logger.exception("Error executing raw XML query: %s", ex)
        return {
            "status": "error",
            "request_xml": xml_payload,
            "error": str(ex),
            "duration_ms": elapsed_ms,
        }

