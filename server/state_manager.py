"""State manager with background polling, quick presets, and WebSocket event broadcasting."""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Set, Any
from datetime import datetime
from fastapi import WebSocket

from ..gb50.client import GB50Client
from ..gb50.models import GroupStatus, SystemInfo, GroupControlRequest, ScheduleItem, AlarmRecord
from ..gb50.constants import DriveState, OperationMode, FanSpeed, AirDirection, ModelType

logger = logging.getLogger("gb50.state_manager")


class StateManager:
    """Manages cached controller state, quick presets, and real-time WebSocket subscriber updates."""

    def __init__(self, client: GB50Client, poll_interval: float = 3.0) -> None:
        self.client = client
        self.poll_interval = poll_interval
        self._system_info: Optional[SystemInfo] = None
        self._groups_cache: Dict[int, GroupStatus] = {}
        self._subscribers: Set[WebSocket] = set()
        self._poll_task: Optional[asyncio.Task] = None
        self._running = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start background polling worker."""
        self._running = True
        logger.info(f"Starting GB-50 state manager (target: {self.client.host}, poll: {self.poll_interval}s)")
        
        # Initial synchronous fetch
        try:
            self._system_info = await self.client.get_system_info()
            groups = await self.client.get_all_groups(refresh_topology=True)
            async with self._lock:
                for g in groups:
                    self._groups_cache[g.group_id] = g
            logger.info(f"Initial discovery loaded {len(self._groups_cache)} groups from {self._system_info.system_name}")
        except Exception as ex:
            logger.error(f"Error during initial controller fetch: {ex}")

        self._poll_task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        """Stop background polling worker and disconnect WebSockets."""
        self._running = False
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        
        for ws in list(self._subscribers):
            try:
                await ws.close()
            except Exception:
                pass
        self._subscribers.clear()
        logger.info("GB-50 state manager stopped")

    async def _poll_loop(self) -> None:
        """Background continuous polling loop."""
        while self._running:
            try:
                await asyncio.sleep(self.poll_interval)
                groups = await self.client.get_all_groups()
                changes: List[Dict[str, Any]] = []
                
                async with self._lock:
                    for g in groups:
                        old_g = self._groups_cache.get(g.group_id)
                        if old_g is None or old_g.model_dump() != g.model_dump():
                            self._groups_cache[g.group_id] = g
                            changes.append(g.model_dump())
                
                if changes:
                    await self._broadcast({"event": "group_updates", "groups": changes})
            except asyncio.CancelledError:
                break
            except Exception as ex:
                logger.warning(f"Error polling GB-50 controller: {ex}")

    async def _broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast JSON message to all active WebSocket clients."""
        dead_sockets: List[WebSocket] = []
        for ws in list(self._subscribers):
            try:
                await ws.send_json(message)
            except Exception:
                dead_sockets.append(ws)
        
        for ws in dead_sockets:
            self._subscribers.discard(ws)

    def register_ws(self, ws: WebSocket) -> None:
        """Register a new WebSocket connection."""
        self._subscribers.add(ws)

    def unregister_ws(self, ws: WebSocket) -> None:
        """Unregister a disconnected WebSocket."""
        self._subscribers.discard(ws)

    async def get_system_info(self) -> SystemInfo:
        """Return system metadata (cached or fetched)."""
        if self._system_info is None:
            self._system_info = await self.client.get_system_info()
        return self._system_info

    async def get_all_groups(self) -> List[GroupStatus]:
        """Return all groups from in-memory cache."""
        async with self._lock:
            if not self._groups_cache:
                groups = await self.client.get_all_groups()
                for g in groups:
                    self._groups_cache[g.group_id] = g
            return list(self._groups_cache.values())

    async def get_group(self, group_id: int) -> Optional[GroupStatus]:
        """Return single group by ID."""
        async with self._lock:
            if group_id in self._groups_cache:
                return self._groups_cache[group_id]
        return await self.client.get_group(group_id)

    async def control_group(self, group_id: int, request: GroupControlRequest) -> GroupStatus:
        """Send command to controller and immediately refresh local cache."""
        await self.client.set_group(
            group_id=group_id,
            drive=request.drive,
            mode=request.mode,
            set_temp_c=request.set_temp_c,
            set_temp_f=request.set_temp_f,
            air_direction=request.air_direction,
            fan_speed=request.fan_speed,
            remote_lock=request.remote_lock,
        )
        await asyncio.sleep(0.2)
        updated = await self.client.get_group(group_id)
        async with self._lock:
            self._groups_cache[group_id] = updated
        await self._broadcast({"event": "group_updates", "groups": [updated.model_dump()]})
        return updated

    async def control_groups_batch(self, updates: Dict[int, GroupControlRequest]) -> List[GroupStatus]:
        """Send batch command to controller and refresh local cache."""
        await self.client.set_groups_batch(updates)
        await asyncio.sleep(0.3)
        groups = await self.client.get_all_groups()
        async with self._lock:
            for g in groups:
                self._groups_cache[g.group_id] = g
        await self._broadcast({"event": "group_updates", "groups": [g.model_dump() for g in groups]})
        return groups

    async def rename_group(self, group_id: int, new_name: str) -> GroupStatus:
        """Rename group web display name."""
        await self.client.set_group_name(group_id, new_name)
        await asyncio.sleep(0.2)
        groups = await self.client.get_all_groups(refresh_topology=True)
        async with self._lock:
            for g in groups:
                self._groups_cache[g.group_id] = g
        updated = self._groups_cache.get(group_id) or await self.client.get_group(group_id)
        await self._broadcast({"event": "group_updates", "groups": [updated.model_dump()]})
        return updated

    async def reset_filter(self, group_id: int) -> GroupStatus:
        """Clear dirty air filter flag."""
        await self.client.reset_filter(group_id)
        await asyncio.sleep(0.2)
        updated = await self.client.get_group(group_id)
        async with self._lock:
            self._groups_cache[group_id] = updated
        await self._broadcast({"event": "group_updates", "groups": [updated.model_dump()]})
        return updated

    async def get_schedule(self, group_id: int) -> List[ScheduleItem]:
        """Fetch today schedule for group."""
        return await self.client.get_today_schedule(group_id)

    async def get_alarms(self) -> List[AlarmRecord]:
        """Retrieve active unit malfunction alarms."""
        return await self.client.get_alarms()

    async def apply_preset(self, preset_name: str) -> List[GroupStatus]:
        """Apply a pre-configured quick scene across church zones."""
        groups = await self.get_all_groups()
        updates: Dict[int, GroupControlRequest] = {}
        
        if preset_name == "sunday":
            # Sunday Service: All AC units ON, 70°F, AUTO; Lossnays ON, LC_AUTO, HIGH
            for g in groups:
                if g.model == ModelType.LC:
                    updates[g.group_id] = GroupControlRequest(
                        drive=DriveState.ON,
                        mode=OperationMode.LC_AUTO,
                        fan_speed=FanSpeed.HIGH,
                    )
                else:
                    updates[g.group_id] = GroupControlRequest(
                        drive=DriveState.ON,
                        mode=OperationMode.AUTO,
                        set_temp_f=70.0,
                        fan_speed=FanSpeed.AUTO,
                    )
        elif preset_name == "all_off":
            # Turn everything OFF
            for g in groups:
                updates[g.group_id] = GroupControlRequest(drive=DriveState.OFF)
        elif preset_name == "office":
            # Office hours: Groups named office ON, all other zones OFF
            for g in groups:
                if 'office' in g.name.lower():
                    updates[g.group_id] = GroupControlRequest(
                        drive=DriveState.ON,
                        mode=OperationMode.AUTO,
                        set_temp_f=70.0,
                        fan_speed=FanSpeed.AUTO,
                    )
                else:
                    updates[g.group_id] = GroupControlRequest(drive=DriveState.OFF)
        elif preset_name == "night":
            # Night Setback: All units OFF with setback limits active
            for g in groups:
                updates[g.group_id] = GroupControlRequest(drive=DriveState.OFF)
        else:
            raise ValueError(f"Unknown preset name: '{preset_name}'")

        return await self.control_groups_batch(updates)
