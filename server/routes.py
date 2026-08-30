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
            return self.set_temp_c
        if self.set_temp_f is not None:
            return round((self.set_temp_f - 32.0) * 5.0 / 9.0, 1)
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
async def reset_filter(group_id: int, mgr: StateManager = Depends(get_state_mgr)) -> GroupStatus:
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
) -> List[GroupStatus]:
    """Control multiple HVAC groups simultaneously in a single transaction."""
    try:
        return await mgr.control_groups_batch(request.groups)
    except Exception as ex:
        logger.exception("Error in POST /api/v1/groups/batch: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/presets/{preset_name}", response_model=List[GroupStatus], summary="Apply Quick Scene Preset")
async def apply_preset(preset_name: str, mgr: StateManager = Depends(get_state_mgr)) -> List[GroupStatus]:
    """Apply a one-touch church preset scene ('sunday', 'all_off', 'office', 'night')."""
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
) -> Dict[str, Any]:
    """Update all Indoor Unit -> LOSSNAY ventilation pairings on the controller."""
    try:
        pairings = [p.model_dump() for p in request.pairings]
        await mgr.client.set_interlocks(pairings)
        return {"status": "success", "message": f"{len(pairings)} Interlock pairings saved to controller"}
    except Exception as ex:
        logger.exception("Error in PUT /api/v1/interlocks: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/schedules", summary="Get All Groups Today Schedules")
async def get_all_schedules(mgr: StateManager = Depends(get_state_mgr)) -> Dict[int, List[ScheduleItem]]:
    """Retrieve today's programmed timer events across all configured groups simultaneously."""
    try:
        return await mgr.client.get_all_today_schedules()
    except Exception as ex:
        logger.exception("Error in GET /api/v1/schedules: %s", ex)
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


@router.put("/schedules/today", summary="Update Today's Schedule for Group(s)")
async def update_today_schedule(
    request: UpdateTodayScheduleRequest,
    mgr: StateManager = Depends(get_state_mgr),
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
async def sync_clock(mgr: StateManager = Depends(get_state_mgr)) -> Dict[str, Any]:
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
) -> Dict[str, Any]:
    """Register and activate a 16-character license key code for an optional software function."""
    try:
        await mgr.client.register_option(request.func_index, request.key_code)
        await mgr.refresh_system_info()
        return {"status": "success", "message": f"License code accepted for Function {request.func_index}"}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/options/register: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.get("/users", summary="Get User Accounts List")
async def get_users(mgr: StateManager = Depends(get_state_mgr)) -> List[Dict[str, Any]]:
    """Retrieve user accounts and decrypted passwords across categories."""
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
        logger.exception("Error in GET /api/v1/users: %s", ex)
        raise HTTPException(status_code=500, detail=str(ex))


@router.post("/users/{user}/password", summary="Change User Password")
async def change_password(
    user: str,
    request: UpdatePasswordRequest,
    mgr: StateManager = Depends(get_state_mgr),
) -> Dict[str, str]:
    """Change the password for a user account."""
    try:
        await mgr.client.set_user_password(user, request.new_password)
        return {"status": "success", "message": f"Password for user '{user}' updated successfully"}
    except Exception as ex:
        logger.exception("Error in POST /api/v1/users/%s/password: %s", user, ex)
        raise HTTPException(status_code=500, detail=str(ex))


# --- WebSocket Stream ---

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket stream providing real-time group telemetry change events."""
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
