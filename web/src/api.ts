import { 
  GroupStatus, 
  SystemInfo, 
  GroupControlRequest, 
  ScheduleItem, 
  AlarmRecord,
  GroupConfigPayload,
  UnassignedAddressesResponse,
  UserProfile,
  LoginResponse,
  CreateUserPayload,
  UpdateUserPayload
} from './types';

const API_BASE = '/api/v1';

// Token Storage
let currentToken: string | null = localStorage.getItem('gb50_auth_token');

export function setAuthToken(token: string | null) {
  currentToken = token;
  if (token) {
    localStorage.setItem('gb50_auth_token', token);
  } else {
    localStorage.removeItem('gb50_auth_token');
  }
}

export function getAuthToken(): string | null {
  return currentToken;
}

// Wrapper for all authenticated API requests
async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && !input.includes('/auth/login')) {
    window.dispatchEvent(new Event('auth_unauthorized'));
  }
  return res;
}


// --- Authentication APIs ---

export async function loginUser(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Login failed: ${res.statusText}`);
  }
  const data: LoginResponse = await res.json();
  setAuthToken(data.access_token);
  return data;
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE}/auth/me`);
  if (!res.ok) throw new Error(`Not authenticated: ${res.statusText}`);
  return res.json();
}

export async function changeOwnPassword(oldPassword: string, newPassword: string): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to change password: ${res.statusText}`);
  }
  return res.json();
}

export function logoutUser() {
  setAuthToken(null);
  window.dispatchEvent(new Event('auth_logout'));
}


// --- Proxy User Management (Admin Only) ---

export async function fetchProxyUsers(): Promise<UserProfile[]> {
  const res = await authFetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error(`Failed to fetch proxy users: ${res.statusText}`);
  return res.json();
}

export async function createProxyUser(payload: CreateUserPayload): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to create user: ${res.statusText}`);
  }
  return res.json();
}

export async function updateProxyUser(userId: number, payload: UpdateUserPayload): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update user: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteProxyUser(userId: number): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/users/${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to delete user: ${res.statusText}`);
  }
  return res.json();
}


// --- System & Group APIs ---

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const res = await authFetch(`${API_BASE}/system`);
  if (!res.ok) throw new Error(`Failed to fetch system info: ${res.statusText}`);
  return res.json();
}

export async function updateSystemInfo(settings: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/system`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update system settings: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchGroups(): Promise<GroupStatus[]> {
  const res = await authFetch(`${API_BASE}/groups`);
  if (!res.ok) throw new Error(`Failed to fetch groups: ${res.statusText}`);
  return res.json();
}

export async function controlGroup(groupId: number, request: GroupControlRequest): Promise<GroupStatus> {
  const res = await authFetch(`${API_BASE}/groups/${groupId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to control group: ${res.statusText}`);
  }
  return res.json();
}

export async function renameGroup(groupId: number, name: string): Promise<GroupStatus> {
  const res = await authFetch(`${API_BASE}/groups/${groupId}/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to rename group: ${res.statusText}`);
  }
  return res.json();
}

export async function batchControl(groups: Record<number, GroupControlRequest>): Promise<GroupStatus[]> {
  const res = await authFetch(`${API_BASE}/groups/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to execute batch control: ${res.statusText}`);
  }
  return res.json();
}

export async function applyPreset(presetName: 'sunday' | 'all_off' | 'office' | 'night'): Promise<GroupStatus[]> {
  const res = await authFetch(`${API_BASE}/presets/${presetName}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to apply preset: ${res.statusText}`);
  }
  return res.json();
}

export async function resetFilter(groupId: number): Promise<GroupStatus> {
  const res = await authFetch(`${API_BASE}/groups/${groupId}/reset-filter`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to reset filter: ${res.statusText}`);
  }
  return res.json();
}


// --- Schedules, Interlocks, Alarms, Clock, SummerTime, Setback ---

export async function fetchWeeklySchedule(groupId: number, season = 1): Promise<Record<number, ScheduleItem[]>> {
  const res = await authFetch(`${API_BASE}/schedules/${groupId}/weekly?season=${season}`);
  if (!res.ok) throw new Error(`Failed to fetch weekly schedule for group ${groupId}: ${res.statusText}`);
  return res.json();
}

export async function updateWeeklySchedule(
  groupIds: number[], 
  dayOfWeek: number, 
  events: Array<Record<string, any>>
): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/schedules/weekly`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group_ids: groupIds,
      day_of_week: dayOfWeek,
      events,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update weekly schedule: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchInterlocks(): Promise<Array<{ ic_address: number; lc_address: number }>> {
  const res = await authFetch(`${API_BASE}/interlocks`);
  if (!res.ok) throw new Error(`Failed to fetch interlocks: ${res.statusText}`);
  return res.json();
}

export async function updateInterlocks(
  pairings: Array<{ ic_address: number; lc_address: number }>
): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/interlocks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update interlocks: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAlarms(): Promise<AlarmRecord[]> {
  const res = await authFetch(`${API_BASE}/alarms`);
  if (!res.ok) throw new Error(`Failed to fetch alarms: ${res.statusText}`);
  return res.json();
}

export async function clearAlarms(): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/alarms`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to clear alarms: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchClock(): Promise<{ current_time: string }> {
  const res = await authFetch(`${API_BASE}/clock`);
  if (!res.ok) throw new Error(`Failed to fetch clock: ${res.statusText}`);
  return res.json();
}

export async function syncClock(): Promise<{ status: string; synchronized_time: string }> {
  const res = await authFetch(`${API_BASE}/clock/sync`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to sync clock: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchSummerTime(): Promise<Record<string, any>> {
  const res = await authFetch(`${API_BASE}/clock/summertime`);
  if (!res.ok) throw new Error(`Failed to fetch Summer Time settings: ${res.statusText}`);
  return res.json();
}

export async function updateSummerTime(settings: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/clock/summertime`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update Summer Time settings: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchSetback(): Promise<Record<string, any>> {
  const res = await authFetch(`${API_BASE}/setback`);
  if (!res.ok) throw new Error(`Failed to fetch setback settings: ${res.statusText}`);
  return res.json();
}

export async function updateSetback(settings: Record<string, any>): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/setback`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update setback settings: ${res.statusText}`);
  }
  return res.json();
}

export async function registerOptionLicense(funcIndex: number, keyCode: string): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/options/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ func_index: funcIndex, key_code: keyCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to register license: ${res.statusText}`);
  }
  return res.json();
}

export async function createGroup(payload: GroupConfigPayload): Promise<{ status: string; message: string; group_id: number }> {
  const res = await authFetch(`${API_BASE}/groups`, {
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
  const res = await authFetch(`${API_BASE}/groups/${groupId}/config`, {
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
  const res = await authFetch(`${API_BASE}/groups/${groupId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to delete group: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchUnassignedAddresses(): Promise<UnassignedAddressesResponse> {
  const res = await authFetch(`${API_BASE}/unassigned-addresses`);
  if (!res.ok) throw new Error(`Failed to fetch unassigned addresses: ${res.statusText}`);
  return res.json();
}


// --- Real-time WebSocket Subscription ---

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
    const tokenQuery = currentToken ? `?token=${encodeURIComponent(currentToken)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws${tokenQuery}`;
    
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
