import { 
  GroupStatus, 
  SystemInfo, 
  GroupControlRequest, 
  ScheduleItem, 
  AlarmRecord,
  GroupConfigPayload,
  UnassignedAddressesResponse
} from './types';

const API_BASE = '/api/v1';

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const res = await fetch(`${API_BASE}/system`);
  if (!res.ok) throw new Error(`Failed to fetch system info: ${res.statusText}`);
  return res.json();
}

export async function updateSystemInfo(settings: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/system`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to update system settings: ${res.statusText}`);
  return res.json();
}

export async function fetchGroups(): Promise<GroupStatus[]> {
  const res = await fetch(`${API_BASE}/groups`);
  if (!res.ok) throw new Error(`Failed to fetch groups: ${res.statusText}`);
  return res.json();
}

export async function controlGroup(groupId: number, request: GroupControlRequest): Promise<GroupStatus> {
  const res = await fetch(`${API_BASE}/groups/${groupId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`Failed to control group: ${res.statusText}`);
  return res.json();
}

export async function renameGroup(groupId: number, name: string): Promise<GroupStatus> {
  const res = await fetch(`${API_BASE}/groups/${groupId}/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to rename group: ${res.statusText}`);
  return res.json();
}

export async function configureGroupHardware(
  groupId: number,
  config: { name: string; primary_ic: number; model: string; slave_ics?: number[]; rcs?: number[] }
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/groups/${groupId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to configure group hardware: ${res.statusText}`);
  return res.json();
}

export async function resetFilter(groupId: number): Promise<GroupStatus> {
  const res = await fetch(`${API_BASE}/groups/${groupId}/reset-filter`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to reset filter: ${res.statusText}`);
  return res.json();
}

export async function batchControl(groups: Record<number, GroupControlRequest>): Promise<GroupStatus[]> {
  const res = await fetch(`${API_BASE}/groups/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  });
  if (!res.ok) throw new Error(`Failed to batch control: ${res.statusText}`);
  return res.json();
}

export async function applyPreset(presetName: 'sunday' | 'all_off' | 'office' | 'night'): Promise<GroupStatus[]> {
  const res = await fetch(`${API_BASE}/presets/${presetName}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to apply preset: ${res.statusText}`);
  return res.json();
}

export async function fetchSchedule(groupId: number): Promise<ScheduleItem[]> {
  const res = await fetch(`${API_BASE}/schedules/${groupId}`);
  if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.statusText}`);
  return res.json();
}

export async function fetchAllTodaySchedules(): Promise<Record<number, ScheduleItem[]>> {
  const res = await fetch(`${API_BASE}/schedules`);
  if (!res.ok) throw new Error(`Failed to fetch all schedules: ${res.statusText}`);
  return res.json();
}

export async function fetchWeeklySchedule(groupId: number): Promise<Record<number, ScheduleItem[]>> {
  const res = await fetch(`${API_BASE}/schedules/${groupId}/weekly`);
  if (!res.ok) throw new Error(`Failed to fetch weekly schedule: ${res.statusText}`);
  return res.json();
}

export async function updateTodaySchedule(
  groupIds: number[],
  events: Array<{ hour: number; minute: number; drive: 'ON' | 'OFF'; mode?: string; set_temp_f?: number; set_temp_c?: number; fan_speed?: string; air_direction?: string }>
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/schedules/today`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_ids: groupIds, events }),
  });
  if (!res.ok) throw new Error(`Failed to update today schedule: ${res.statusText}`);
  return res.json();
}

export async function updateWeeklySchedule(
  groupIds: number[],
  dayOfWeek: number,
  events: Array<{ hour: number; minute: number; drive: 'ON' | 'OFF'; mode?: string; set_temp_f?: number; set_temp_c?: number; fan_speed?: string; air_direction?: string }>
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/schedules/weekly`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_ids: groupIds, day_of_week: dayOfWeek, events }),
  });
  if (!res.ok) throw new Error(`Failed to update weekly schedule: ${res.statusText}`);
  return res.json();
}

export async function fetchAlarms(priorityLevel?: number): Promise<AlarmRecord[]> {
  const url = priorityLevel !== undefined ? `${API_BASE}/alarms?priority_level=${priorityLevel}` : `${API_BASE}/alarms`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch alarms: ${res.statusText}`);
  return res.json();
}

export async function clearAlarmHistory(priorityLevel: number = 2): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/alarms?priority_level=${priorityLevel}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to clear alarm history: ${res.statusText}`);
  return res.json();
}

export async function fetchClock(): Promise<{ current_time: string }> {
  const res = await fetch(`${API_BASE}/clock`);
  if (!res.ok) throw new Error(`Failed to fetch clock: ${res.statusText}`);
  return res.json();
}

export async function syncClock(): Promise<{ status: string; synchronized_time: string }> {
  const res = await fetch(`${API_BASE}/clock/sync`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to sync clock: ${res.statusText}`);
  return res.json();
}

export async function fetchSummerTime(): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}/clock/summertime`);
  if (!res.ok) throw new Error(`Failed to fetch SummerTime: ${res.statusText}`);
  return res.json();
}

export async function updateSummerTime(config: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/clock/summertime`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to update SummerTime: ${res.statusText}`);
  return res.json();
}

export async function fetchInterlocks(): Promise<Array<{ ic_address: number; lc_address: number }>> {
  const res = await fetch(`${API_BASE}/interlocks`);
  if (!res.ok) throw new Error(`Failed to fetch interlocks: ${res.statusText}`);
  return res.json();
}

export async function updateInterlocks(pairings: Array<{ ic_address: number; lc_address: number }>): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/interlocks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairings }),
  });
  if (!res.ok) throw new Error(`Failed to update interlocks: ${res.statusText}`);
  return res.json();
}

export async function fetchSetback(): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}/setback`);
  if (!res.ok) throw new Error(`Failed to fetch setback: ${res.statusText}`);
  return res.json();
}

export async function updateSetback(config: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/setback`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to update setback: ${res.statusText}`);
  return res.json();
}

export async function registerOptionLicense(func_index: number, key_code: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/options/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ func_index, key_code }),
  });
  if (!res.ok) throw new Error(`Failed to register option: ${res.statusText}`);
  return res.json();
}

export async function fetchUsers(): Promise<Array<{ user: string; password?: string; category: string; available_group?: string }>> {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.statusText}`);
  return res.json();
}

export async function changeUserPassword(user: string, newPassword: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/users/${user}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  });
  if (!res.ok) throw new Error(`Failed to update password: ${res.statusText}`);
  return res.json();
}

// WebSocket Live Stream with auto-reconnection
export function subscribeToWebSocket(
  onUpdate: (groups: GroupStatus[]) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let isClosed = false;

  function connect() {
    if (isClosed) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      onStatusChange?.(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'initial_state' || data.event === 'group_updates') {
          onUpdate(data.groups);
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onclose = () => {
      onStatusChange?.(false);
      if (!isClosed) {
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    isClosed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

export async function createGroup(payload: GroupConfigPayload): Promise<{ status: string; message: string; group_id: number }> {
  const res = await fetch(`${API_BASE}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to create group: ${res.statusText}`);
  }
  return res.json();
}

export async function updateGroupConfig(groupId: number, payload: GroupConfigPayload): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/groups/${groupId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update group config: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteGroup(groupId: number): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/groups/${groupId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to delete group: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchUnassignedAddresses(): Promise<UnassignedAddressesResponse> {
  const res = await fetch(`${API_BASE}/unassigned-addresses`);
  if (!res.ok) throw new Error(`Failed to fetch unassigned addresses: ${res.statusText}`);
  return res.json();
}
