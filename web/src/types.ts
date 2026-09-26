export type DriveState = 'ON' | 'OFF' | 'TESTRUN';

export type OperationMode =
  | 'FAN'
  | 'COOL'
  | 'HEAT'
  | 'DRY'
  | 'AUTO'
  | 'AUTOCOOL'
  | 'AUTOHEAT'
  | 'VENTILATE'
  | 'LC_AUTO'
  | 'BYPASS'
  | 'HEATRECOVERY'
  | 'HEATING'
  | 'HOT_WATER'
  | 'COOLING';

export type AirDirection =
  | 'SWING'
  | 'VERTICAL'
  | 'MID2'
  | 'MID1'
  | 'HORIZONTAL'
  | 'MID0'
  | 'AUTO';

export type FanSpeed = 'LOW' | 'MID2' | 'MID1' | 'HIGH' | 'AUTO' | 'EXLOW';

export type ModelType = 'IC' | 'LC' | 'OC' | 'BC' | 'SC' | 'RC' | '??';

export interface GroupCapabilities {
  has_auto_mode: boolean;
  has_dry_mode: boolean;
  has_fan_speed: boolean;
  has_air_direction: boolean;
  has_swing: boolean;
  has_ventilation: boolean;
  has_bypass: boolean;
  has_heat_recovery: boolean;
  fan_speed_stages: number;
  air_direction_stages: number;
  temp_min_cool_c: number;
  temp_max_cool_c: number;
  temp_min_heat_c: number;
  temp_max_heat_c: number;
  temp_min_auto_c: number;
  temp_max_auto_c: number;
  temp_min_cool_f: number;
  temp_max_cool_f: number;
  temp_min_heat_f: number;
  temp_max_heat_f: number;
}

export interface GroupStatus {
  group_id: number;
  name: string;
  room_name?: string;
  area_name?: string;
  floor?: number;
  model: ModelType;
  address: number;
  slave_addresses: number[];
  drive: DriveState;
  mode: OperationMode;
  set_temp_c?: number;
  set_temp_f?: number;
  inlet_temp_c?: number;
  inlet_temp_f?: number;
  air_direction: AirDirection;
  fan_speed: FanSpeed;
  schedule_enabled: boolean;
  filter_dirty: boolean;
  error_active: boolean;
  remote_lock: 'PERMIT' | 'PROHIBIT';
  capabilities?: GroupCapabilities;
  raw_bulk?: string;
}

export interface SystemInfo {
  version: string;
  model: string;
  serial_number: string;
  system_name: string;
  location_id: string;
  ip_address: string;
  subnet_mask: string;
  gateway: string;
  mac_address: string;
  mnet_address: number;
  temp_unit: string;
  date_format: string;
  time_format: string;
  licensed_functions: Record<string, boolean>;
}

export interface ScheduleItem {
  index: number;
  hour: number;
  minute: number;
  drive?: DriveState;
  mode?: OperationMode;
  set_temp_c?: number;
  set_temp_f?: number;
  air_direction?: AirDirection;
  fan_speed?: FanSpeed;
  time_str: string;
  remote_lock?: 'PERMIT' | 'PROHIBIT';
  source_program_id?: number;
  source_program_name?: string;
}

export interface ScheduleEventInput {
  hour: number;
  minute: number;
  drive: 'ON' | 'OFF';
  mode?: OperationMode;
  set_temp_f?: number;
  set_temp_c?: number;
  fan_speed?: FanSpeed;
  air_direction?: AirDirection;
  remote_lock?: 'PERMIT' | 'PROHIBIT';
}

export interface AlarmRecord {
  index: number;
  address: number;
  unit_name?: string;
  unit_model: string;
  detect_address: number;
  detect_name?: string;
  error_code: string;
  priority_level: number;
  occurred_at?: string;
  recovered_at?: string;
  is_active: boolean;
  duration_str?: string;
  title: string;
  category: string;
  description: string;
  troubleshooting: string;
  message: string;
}

export interface GroupControlRequest {
  drive?: DriveState;
  mode?: OperationMode;
  set_temp_f?: number;
  set_temp_c?: number;
  air_direction?: AirDirection;
  fan_speed?: FanSpeed;
  remote_lock?: 'PERMIT' | 'PROHIBIT';
}

export interface GroupConfigPayload {
  group_id?: number;
  name: string;
  primary_ic: number;
  model: 'IC' | 'LC';
  slave_ics: number[];
  rcs?: number[];
  floor?: number;
}

export interface UnassignedAddressesResponse {
  assigned_count: number;
  unassigned_count: number;
  unassigned_addresses: number[];
  assigned_addresses: number[];
}

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface UserProfile {
  id: number;
  username: string;
  role: UserRole;
  display_name: string;
  created_at?: string;
  last_login?: string;
  enabled?: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: UserProfile;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: UserRole;
  display_name: string;
}

export interface UpdateUserPayload {
  role?: UserRole;
  display_name?: string;
  enabled?: boolean;
  new_password?: string;
}

export interface SeasonConfig {
  season_id: number;
  name: string;
  description?: string;
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  color: string;
  enabled: boolean;
  is_active_today?: boolean;
  updated_at?: string;
}

export interface SeasonCloneRequest {
  mode_transformation: 'NONE' | 'COOL_TO_HEAT' | 'HEAT_TO_COOL' | 'INVERT';
  setpoint_offset_f: number;
  conflict_strategy: 'REPLACE' | 'APPEND';
  auto_flash_hardware?: boolean;
}

export interface DuplicateProgramPayload {
  target_season_id?: number;
  name_suffix?: string;
  mode_transformation?: 'NONE' | 'COOL_TO_HEAT' | 'HEAT_TO_COOL' | 'INVERT';
  setpoint_offset_f?: number;
}

export interface ScheduleProgram {
  id: number;
  name: string;
  description: string;
  color: string;
  season_id?: number;
  season_scope?: string[];
  weekly_pattern: Record<number, ScheduleItem[]>;
  metadata_json?: Record<string, any>;
  assigned_group_ids: number[];
  sync_status: 'SYNCED' | 'DRIFT_DETECTED' | 'PENDING' | 'ERROR';
  weekly_hours: number;
  created_at?: string;
  updated_at?: string;
}

export interface StaffSchedule {
  id?: number;
  name: string;
  roomIds: number[];
  recurrence: {
    kind: 'weekly' | 'once';
    days: number[]; // 1=Mon..7=Sun
    startDate?: string;
    endDate?: string;
    seasonId?: number;
  };
  occupiedStart: string;
  occupiedEnd: string;
  temperatureF: number;
  mode: OperationMode;
  thermostatAdjustmentsAllowed: boolean;
  status: 'draft' | 'publishing' | 'published' | 'failed';
  publishedAt?: string;
  weeklyHours?: number;
}

export interface PublishResult {
  schedule_id: number;
  success: boolean;
  total_spaces: number;
  published_spaces: number;
  failed_spaces: number;
  successful_rooms: number[];
  failed_rooms: Array<{ group_id: number; error: string }>;
  published_at: string;
}

export interface PublishProgress {
  event?: string;
  schedule_id: number;
  schedule_name?: string;
  current: number;
  total: number;
  percent: number;
  group_id?: number;
  room_name?: string;
  status: 'flashing' | 'success' | 'failed' | 'completed';
  error?: string | null;
  successful_count: number;
  failed_count: number;
  room_statuses?: Record<number, 'queued' | 'flashing' | 'success' | 'failed'>;
}

export interface SeasonReconcileStatus {
  reconciled: boolean;
  error?: string;
  mismatches: Array<{
    season_id?: number;
    name?: string;
    db?: { start_month: number; start_day: number; end_month: number; end_day: number };
    controller?: { start_month: number; start_day: number; end_month: number; end_day: number };
    error?: string;
  }>;
  db_seasons?: SeasonConfig[];
}

export interface ZoneMetadata {
  room_name: string;
  area_name?: string;
}

// --- Admin Controller Debug & Telemetry Types ---

export interface HexDumpRow {
  offset: string;
  hex: string;
  ascii: string;
}

export interface ByteAnnotation {
  offset: number;
  hex: string;
  dec: number;
  field: string;
  value: string;
}

export interface RawBulkGroup {
  group_id: number;
  name: string;
  model: string;
  address: number;
  raw_hex: string;
  length_bytes: number;
  hex_dump: HexDumpRow[];
  byte_annotations: ByteAnnotation[];
  parsed_fields: Record<string, any>;
}

export interface BulkTelemetryDebugResponse {
  count: number;
  groups: RawBulkGroup[];
}

export interface RawScheduleDebugResponse {
  group_id: number;
  season: number;
  today_request_xml: string;
  today_response_xml: string;
  weekly_request_xml: string;
  weekly_response_xml: string;
  today_records: ScheduleItem[];
  weekly_patterns: Record<string, ScheduleItem[]>;
}

export interface RawTopologyDebugResponse {
  request_xml: string;
  response_xml: string;
  topology: Record<number, any>;
  interlocks: Array<{ ic_address: number; lc_address: number }>;
  assigned_addresses: number[];
  unassigned_addresses: number[];
}

export interface RawSystemDebugResponse {
  request_xml: string;
  response_xml: string;
  system_info: SystemInfo;
}

export interface RawXmlQueryResult {
  status: 'success' | 'error';
  request_xml: string;
  response_xml?: string;
  error?: string;
  duration_ms: number;
}
