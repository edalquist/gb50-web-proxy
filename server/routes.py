"""FastAPI route definitions for the GB-50 REST API & WebSocket proxy."""

from __future__ import annotations

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, status
from pydantic import BaseModel, Field

from gb50.models import (
    GroupStatus,
    SystemInfo,
    ScheduleItem,
    AlarmRecord,
    GroupControlRequest,
)
from gb50.protocol import GB50ProtocolError
from gb50.state_manager import StateManager
from .auth import (
    user_db,
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    get_current_user,
    require_role,
    LoginRequest,
    ChangePasswordRequest,
    CreateUserRequest,
    UpdateUserRequest,
    UserProfileResponse,
)
from .schedule_db import schedule_db
from .schedule_sync import (
    reconstruct_schedules_from_controller,
    push_schedule_to_hardware,
    check_schedule_drift,
    calculate_weekly_runtime_hours,
    merge_programs_for_group,
    sync_group_hardware,
)

logger = logging.getLogger("gb50.api")
router = APIRouter(prefix="/api/v1")


def get_state_mgr(websocket_or_request: Any = None) -> StateManager:
    """Dependency injector for StateManager instance (set on app.state)."""
    raise NotImplementedError


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

    def resolved_temp_c(self) -> Optional[float]:
        if self.set_temp_c is not None:
            return round(self.set_temp_c * 2) / 2
        if self.set_temp_f is not None:
            raw_c = (self.set_temp_f - 32.0) * 5.0 / 9.0
            return round(raw_c * 2) / 2
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


class CreateScheduleProgramRequest(BaseModel):
    """Payload to create a new named schedule program."""
    name: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = Field("", max_length=200)
    color: Optional[str] = Field("blue", max_length=20)
    weekly_pattern: Optional[Dict[int, List[Dict[str, Any]]]] = None
    assigned_group_ids: Optional[List[int]] = Field(default_factory=list)


class UpdateScheduleProgramRequest(BaseModel):
    """Payload to update an existing named schedule program."""
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=200)
    color: Optional[str] = Field(None, max_length=20)
    weekly_pattern: Optional[Dict[int, List[Dict[str, Any]]]] = None


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
) -> Dict[str, str]:
    """Change the password for the current authenticated user."""
    if not verify_password(request.old_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect current password.")
    user_db.update_user(current_user["id"], new_password=request.new_password)
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
) -> Dict[str, str]:
    """Delete a proxy user account."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own administrator account.")
    success = user_db.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "success", "message": "User deleted successfully."}


# --- System & Group Routes ---

@router.get("/system", response_model=SystemInfo, summary="Get Controller System Information")
async def get_system_info(mgr: StateManager = Depends(get_state_mgr)) -> SystemInfo:
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


@router.get("/groups", response_model=List[GroupStatus], summary="Get All HVAC Groups")
async def get_all_groups(mgr: StateManager = Depends(get_state_mgr)) -> List[GroupStatus]:
    """Retrieve real-time telemetry, mode, temperature, and flags for all HVAC groups."""
    try:
        return await mgr.get_all_groups()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/groups: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/groups/{group_id}", response_model=GroupStatus, summary="Get Single HVAC Group")
async def get_group(group_id: int, mgr: StateManager = Depends(get_state_mgr)) -> GroupStatus:
    """Retrieve real-time telemetry for a specific HVAC group by ID (1..50)."""
    try:
        group = await mgr.get_group(group_id)
        if group is None:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found")
        return group
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in GET /api/v1/groups/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/groups/{group_id}", response_model=GroupStatus, summary="Control HVAC Group")
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


@router.put("/groups/{group_id}/name", response_model=GroupStatus, summary="Rename HVAC Group")
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


@router.put("/groups/{group_id}/config", summary="Configure Group Hardware Mapping")
async def configure_group_hardware(
    group_id: int,
    request: UpdateGroupConfigRequest,
    mgr: StateManager = Depends(get_state_mgr),
    _admin: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Configure a group's display name, primary IC address, slave ICs, remote controllers (RC), and floor."""
    try:
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
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/groups/%s/config: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.delete("/groups/{group_id}", summary="Delete HVAC Group")
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


@router.post("/groups/{group_id}/reset-filter", response_model=GroupStatus, summary="Reset Air Filter Sign")
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
async def get_interlocks(mgr: StateManager = Depends(get_state_mgr)) -> List[Dict[str, int]]:
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


# --- Schedule Programs (Schedule-First Architecture) ---

@router.get("/schedules/programs", summary="List All Named Schedule Programs")
async def list_schedule_programs(
    mgr: StateManager = Depends(get_state_mgr),
) -> List[Dict[str, Any]]:
    """Retrieve all named schedule programs, assigned zones, and sync status."""
    try:
        if schedule_db.count_schedules() == 0:
            # Self-healing auto-reconstruct from controller hardware
            progs = await reconstruct_schedules_from_controller(mgr.client)
        else:
            progs = schedule_db.list_schedules()
        
        # Calculate runtime hours for each program
        for p in progs:
            p["weekly_hours"] = calculate_weekly_runtime_hours(p["weekly_pattern"])
        return progs
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/programs: %s", ex)
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
        )
        if request.assigned_group_ids:
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
        prog = schedule_db.update_schedule(
            schedule_id=program_id,
            name=request.name,
            description=request.description,
            color=request.color,
            weekly_pattern=request.weekly_pattern,
        )
        if not prog:
            raise HTTPException(status_code=404, detail="Schedule program not found")

        # Push updated 7-day pattern to controller hardware for all assigned zones
        if prog["assigned_group_ids"]:
            await push_schedule_to_hardware(mgr.client, program_id)
            prog = schedule_db.get_schedule(program_id)

        prog["weekly_hours"] = calculate_weekly_runtime_hours(prog["weekly_pattern"])
        return prog
    except HTTPException:
        raise
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/schedules/programs/%s: %s", program_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.delete("/schedules/programs/{program_id}", summary="Delete Named Schedule Program")
async def delete_schedule_program_route(
    program_id: int,
    _role: Dict[str, Any] = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Delete a schedule program from the database."""
    success = schedule_db.delete_schedule(program_id)
    if not success:
        raise HTTPException(status_code=404, detail="Schedule program not found")
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

        schedule_db.assign_zones(program_id, request.group_ids)
        if request.group_ids:
            await push_schedule_to_hardware(mgr.client, program_id)

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
async def get_all_schedules(mgr: StateManager = Depends(get_state_mgr)) -> Dict[int, List[ScheduleItem]]:
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


@router.get("/schedules/{group_id}", response_model=List[ScheduleItem], summary="Get Group Today Schedule")
async def get_schedule(group_id: int, mgr: StateManager = Depends(get_state_mgr)) -> List[ScheduleItem]:
    """Retrieve today's programmed timer events for a specific group."""
    try:
        return await mgr.get_schedule(group_id)
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules/%s: %s", group_id, ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules/{group_id}/weekly", summary="Get Group Weekly Schedule Patterns")
async def get_weekly_schedule(
    group_id: int,
    season: int = 1,
    mgr: StateManager = Depends(get_state_mgr),
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
async def get_clock(mgr: StateManager = Depends(get_state_mgr)) -> Dict[str, Any]:
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
async def get_summertime(mgr: StateManager = Depends(get_state_mgr)) -> Dict[str, Any]:
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
async def get_setback(mgr: StateManager = Depends(get_state_mgr)) -> Dict[str, Any]:
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
    """Retrieve user accounts and decrypted passwords stored directly on controller hardware."""
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
) -> None:
    """Authenticated WebSocket stream providing real-time group telemetry change events."""
    # Extract token from query parameter or cookie
    auth_token = token or websocket.cookies.get("gb50_token")
    if not auth_token:
        # Check subprotocols or headers if present
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            auth_token = auth_header.split(" ", 1)[1].strip()

    payload = decode_access_token(auth_token) if auth_token else None
    if not payload:
        logger.warning("Rejecting unauthenticated WebSocket connection attempt from %s", websocket.client)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    mgr: StateManager = websocket.app.state.state_manager
    await websocket.accept()
    mgr.register_ws(websocket)
    
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
