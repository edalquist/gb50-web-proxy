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

export interface ActivityProgram {
  id: string;
  name: string;
  description: string;
  days: number[]; // 7=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  drive: 'ON' | 'OFF';
  mode: OperationMode;
  set_temp_f: number;
  set_temp_c: number;
  fan_speed: FanSpeed;
  assigned_group_ids: number[];
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
