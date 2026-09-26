import { 
  GroupStatus, 
  SystemInfo, 
  GroupControlRequest, 
  ScheduleItem, 
  ScheduleProgram, 
  SeasonConfig, 
  SeasonCloneRequest, 
  DuplicateProgramPayload, 
  AlarmRecord, 
  GroupConfigPayload, 
  UnassignedAddressesResponse, 
  UserProfile, 
  LoginResponse, 
  CreateUserPayload, 
  UpdateUserPayload, 
  PublishResult, 
  PublishProgress,
  SeasonReconcileStatus, 
  ZoneMetadata, 
  StaffSchedule,
  BulkTelemetryDebugResponse,
  RawScheduleDebugResponse,
  RawTopologyDebugResponse,
  RawSystemDebugResponse,
  RawXmlQueryResult
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

export async function fetchKioskSession(): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/kiosk-session`);
  if (!res.ok) {
    throw new Error('Kiosk auto-login not available');
  }
  const data: LoginResponse = await res.json();
  setAuthToken(data.access_token);
  return data;
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

export async function applyPreset(presetName: 'all_on' | 'all_off' | 'occupied' | 'unoccupied' | string): Promise<GroupStatus[]> {
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

// --- Seasons & Calendar API ---

export async function fetchSeasons(): Promise<SeasonConfig[]> {
  const res = await authFetch(`${API_BASE}/schedules/seasons`);
  if (!res.ok) throw new Error(`Failed to fetch seasons: ${res.statusText}`);
  return res.json();
}

export async function updateSeasons(seasons: SeasonConfig[]): Promise<SeasonConfig[]> {
  const res = await authFetch(`${API_BASE}/schedules/seasons`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasons }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update seasons: ${res.statusText}`);
  }
  return res.json();
}

export async function cloneSeason(
  sourceId: number,
  targetId: number,
  data: SeasonCloneRequest
): Promise<{ status: string; cloned_count: number; programs: ScheduleProgram[]; sync_result?: any }> {
  const res = await authFetch(`${API_BASE}/schedules/seasons/${sourceId}/clone-to/${targetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to clone season: ${res.statusText}`);
  }
  return res.json();
}

export async function duplicateProgram(
  programId: number,
  data: DuplicateProgramPayload
): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/programs/${programId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to duplicate program: ${res.statusText}`);
  }
  return res.json();
}

export async function syncSeason(seasonId: number): Promise<{ status: string; result: any }> {
  const res = await authFetch(`${API_BASE}/schedules/sync-season/${seasonId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to sync season: ${res.statusText}`);
  }
  return res.json();
}

export async function syncAllSeasons(): Promise<{ status: string; result: any }> {
  const res = await authFetch(`${API_BASE}/schedules/sync-all-seasons`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to sync all seasons: ${res.statusText}`);
  }
  return res.json();
}

// --- Schedule Programs API (Schedule-First Architecture) ---

export async function fetchSchedulePrograms(seasonId?: number): Promise<ScheduleProgram[]> {
  const url = seasonId ? `${API_BASE}/schedules/programs?season=${seasonId}` : `${API_BASE}/schedules/programs`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to fetch schedule programs: ${res.statusText}`);
  return res.json();
}

export async function createScheduleProgram(data: {
  name: string;
  description?: string;
  color?: string;
  season_id?: number;
  season_scope?: string[];
  weekly_pattern?: Record<number, any[]>;
  assigned_group_ids?: number[];
  metadata_json?: Record<string, any>;
  publish_to_hardware?: boolean;
}): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/programs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to create schedule program: ${res.statusText}`);
  }
  return res.json();
}

export async function updateScheduleProgram(
  id: number,
  data: {
    name?: string;
    description?: string;
    color?: string;
    season_id?: number;
    season_scope?: string[];
    weekly_pattern?: Record<number, any[]>;
    assigned_group_ids?: number[];
    metadata_json?: Record<string, any>;
    publish_to_hardware?: boolean;
  }
): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/programs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update schedule program: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteScheduleProgram(id: number): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/schedules/programs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to delete schedule program: ${res.statusText}`);
  }
  return res.json();
}

export async function assignZonesToProgram(
  id: number,
  groupIds: number[]
): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/programs/${id}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_ids: groupIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to assign zones to schedule program: ${res.statusText}`);
  }
  return res.json();
}

export async function pushScheduleProgramToHardware(id: number): Promise<{ status: string; message: string }> {
  const res = await authFetch(`${API_BASE}/schedules/programs/${id}/push-to-hardware`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to push schedule to hardware: ${res.statusText}`);
  }
  return res.json();
}

export async function reconstructSchedulesFromHardware(): Promise<ScheduleProgram[]> {
  const res = await authFetch(`${API_BASE}/schedules/reconstruct`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to reconstruct schedules: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchZonePrograms(groupId: number): Promise<ScheduleProgram[]> {
  const res = await authFetch(`${API_BASE}/schedules/zones/${groupId}/programs`);
  if (!res.ok) throw new Error(`Failed to fetch zone programs: ${res.statusText}`);
  return res.json();
}

export async function updateZonePrograms(
  groupId: number,
  programIds: number[]
): Promise<{
  status: string;
  group_id: number;
  assigned_programs: ScheduleProgram[];
  merged_pattern: Record<number, ScheduleItem[]>;
  warnings: string[];
}> {
  const res = await authFetch(`${API_BASE}/schedules/zones/${groupId}/programs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ program_ids: programIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update zone programs: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchZoneMergedSchedule(groupId: number): Promise<{
  group_id: number;
  program_ids: number[];
  merged_pattern: Record<number, ScheduleItem[]>;
  warnings: string[];
}> {
  const res = await authFetch(`${API_BASE}/schedules/zones/${groupId}/merged`);
  if (!res.ok) throw new Error(`Failed to fetch merged schedule: ${res.statusText}`);
  return res.json();
}

export async function fetchAllZoneAssignments(): Promise<Record<number, number[]>> {
  const res = await authFetch(`${API_BASE}/schedules/assignments`);
  if (!res.ok) throw new Error(`Failed to fetch schedule assignments: ${res.statusText}`);
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

// --- Zone Metadata & Space Names ---

export async function fetchZoneMetadata(): Promise<Record<number, ZoneMetadata>> {
  const res = await authFetch(`${API_BASE}/zones/metadata`);
  if (!res.ok) throw new Error(`Failed to fetch zone metadata: ${res.statusText}`);
  return res.json();
}

export async function updateZoneMetadata(groupId: number, payload: { room_name: string; area_name?: string }): Promise<any> {
  const res = await authFetch(`${API_BASE}/zones/${groupId}/metadata`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update room name: ${res.statusText}`);
  }
  return res.json();
}

// --- Season Reconciliation ---

export async function checkSeasonReconciliation(): Promise<SeasonReconcileStatus> {
  const res = await authFetch(`${API_BASE}/schedules/seasons/reconcile`);
  if (!res.ok) throw new Error(`Failed to check season reconciliation: ${res.statusText}`);
  return res.json();
}

export async function executeSeasonReconciliation(action: 'push_to_controller' | 'pull_from_controller'): Promise<any> {
  const res = await authFetch(`${API_BASE}/schedules/seasons/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to execute season reconciliation: ${res.statusText}`);
  }
  return res.json();
}

// --- Staff Schedules & Publishing ---

export async function createStaffSchedule(payload: Partial<StaffSchedule> & Record<string, any>): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to create staff schedule: ${res.statusText}`);
  }
  return res.json();
}

export async function updateStaffSchedule(scheduleId: number, payload: Partial<StaffSchedule> & Record<string, any>): Promise<ScheduleProgram> {
  const res = await authFetch(`${API_BASE}/schedules/staff/${scheduleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to update staff schedule: ${res.statusText}`);
  }
  return res.json();
}

export async function publishSchedule(scheduleId: number): Promise<PublishResult> {
  const res = await authFetch(`${API_BASE}/schedules/${scheduleId}/publish`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to publish schedule: ${res.statusText}`);
  }
  return res.json();
}

export async function publishScheduleStream(
  scheduleId: number,
  onProgress?: (progress: PublishProgress) => void,
  removedGroupIds?: number[]
): Promise<PublishResult> {
  const token = currentToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let url = `${API_BASE}/schedules/${scheduleId}/publish?stream=true`;
  if (removedGroupIds && removedGroupIds.length > 0) {
    url += `&removed_group_ids=${encodeURIComponent(removedGroupIds.join(','))}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to publish schedule: ${res.statusText}`);
  }

  if (!res.body) {
    return publishSchedule(scheduleId);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: PublishResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const chunk of lines) {
      const trimmed = chunk.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.replace(/^data:\s*/, '');
      try {
        const payload = JSON.parse(jsonStr);
        if (payload.event === 'error') {
          throw new Error(payload.error || 'Controller error occurred while flashing');
        } else if (payload.event === 'done') {
          finalResult = payload.result;
        } else {
          onProgress?.(payload);
        }
      } catch (err: any) {
        if (err.message && err.message.includes('Controller error')) throw err;
        console.warn('Error parsing progress stream chunk:', err);
      }
    }
  }

  if (finalResult) return finalResult;
  return publishSchedule(scheduleId);
}


// --- Real-time WebSocket Subscription ---

export function subscribeToWebSocket(
  onUpdate: (groups: GroupStatus[]) => void,
  onStatusChange?: (connected: boolean) => void,
  onPublishProgress?: (progress: PublishProgress) => void
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
        } else if (data.event === 'publish_progress') {
          onPublishProgress?.(data);
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

// --- Admin Controller Raw Data Debug Endpoints ---

export async function fetchRawBulkTelemetry(groupId?: number): Promise<BulkTelemetryDebugResponse> {
  const url = groupId ? `${API_BASE}/debug/bulk-telemetry?group_id=${groupId}` : `${API_BASE}/debug/bulk-telemetry`;
  const res = await authFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to fetch raw bulk telemetry: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchRawScheduleDebug(groupId: number, season = 1): Promise<RawScheduleDebugResponse> {
  const res = await authFetch(`${API_BASE}/debug/raw-schedule/${groupId}?season=${season}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to fetch raw schedule registers: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchRawTopologyDebug(): Promise<RawTopologyDebugResponse> {
  const res = await authFetch(`${API_BASE}/debug/raw-topology`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to fetch raw topology: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchRawSystemDebug(): Promise<RawSystemDebugResponse> {
  const res = await authFetch(`${API_BASE}/debug/raw-system`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to fetch raw system info: ${res.statusText}`);
  }
  return res.json();
}

export async function executeRawXmlQuery(
  queryName?: string,
  customXml?: string,
  groupId?: number,
  season?: number
): Promise<RawXmlQueryResult> {
  const res = await authFetch(`${API_BASE}/debug/query-xml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query_name: queryName,
      custom_xml: customXml,
      group_id: groupId,
      season: season,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Failed to execute raw query: ${res.statusText}`);
  }
  return res.json();
}

