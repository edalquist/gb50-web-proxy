import React, { useState, useEffect, useMemo } from 'react';
import { 
  Save, 
  Send, 
  Trash2, 
  Plus, 
  Clock, 
  AlertTriangle, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  Loader2 
} from 'lucide-react';
import { 
  GroupStatus, 
  ScheduleProgram, 
  ScheduleEventInput, 
  OperationMode, 
  SeasonConfig, 
  PublishProgress 
} from '../types';
import { 
  getRoomDisplayName, 
  compactSpaceSummary, 
  formatDaysSummary, 
  detectScheduleConflicts,
  ConflictDetail
} from '../utils/scheduleHelpers';
import { ScheduleTimelineBar } from './ScheduleTimelineBar';

const DAYS_OF_WEEK = [
  { id: 7, label: 'Sunday', short: 'Sun', highlight: true },
  { id: 1, label: 'Monday', short: 'Mon' },
  { id: 2, label: 'Tuesday', short: 'Tue' },
  { id: 3, label: 'Wednesday', short: 'Wed', highlight: true },
  { id: 4, label: 'Thursday', short: 'Thu' },
  { id: 5, label: 'Friday', short: 'Fri' },
  { id: 6, label: 'Saturday', short: 'Sat' },
];

const COLOR_OPTIONS = [
  { id: 'blue', label: 'Blue', badge: 'bg-blue-600 text-white', border: 'border-blue-500' },
  { id: 'emerald', label: 'Emerald', badge: 'bg-emerald-600 text-white', border: 'border-emerald-500' },
  { id: 'purple', label: 'Purple', badge: 'bg-purple-600 text-white', border: 'border-purple-500' },
  { id: 'amber', label: 'Amber', badge: 'bg-amber-600 text-white', border: 'border-amber-500' },
  { id: 'rose', label: 'Rose', badge: 'bg-rose-600 text-white', border: 'border-rose-500' },
  { id: 'cyan', label: 'Cyan', badge: 'bg-cyan-600 text-white', border: 'border-cyan-500' },
  { id: 'indigo', label: 'Indigo', badge: 'bg-indigo-600 text-white', border: 'border-indigo-500' },
  { id: 'slate', label: 'Slate', badge: 'bg-slate-600 text-white', border: 'border-slate-500' },
];

interface CoherentScheduleEditorProps {
  schedule: ScheduleProgram | null;
  groups: GroupStatus[];
  seasons: SeasonConfig[];
  allPrograms: ScheduleProgram[];
  tempUnit: 'F' | 'C';
  onSave: (payload: any, flashToHardware: boolean) => Promise<void>;
  onDelete?: (program: ScheduleProgram) => void;
  onCancel?: () => void;
  isSaving?: boolean;
  publishProgress?: PublishProgress | null;
}

export const CoherentScheduleEditor: React.FC<CoherentScheduleEditorProps> = ({
  schedule,
  groups,
  seasons,
  allPrograms,
  tempUnit,
  onSave,
  onDelete,
  onCancel,
  isSaving = false,
  publishProgress = null,
}) => {
  const isNew = !schedule || !schedule.id;

  // 1. Identity State
  const [name, setName] = useState(schedule?.name || '');
  const [color, setColor] = useState(schedule?.color || 'blue');
  const [seasonId, setSeasonId] = useState<number>(schedule?.season_id || 1);

  // 2. Room Assignment State
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(
    schedule?.assigned_group_ids ? [...schedule.assigned_group_ids] : []
  );
  const [spaceSearch, setSpaceSearch] = useState('');
  const [onlySelectedSpaces, setOnlySelectedSpaces] = useState(false);

  // 3. Active Days State
  const [selectedDays, setSelectedDays] = useState<number[]>(() => {
    if (schedule?.metadata_json?.days && Array.isArray(schedule.metadata_json.days) && schedule.metadata_json.days.length > 0) {
      return [...schedule.metadata_json.days];
    }
    if (schedule?.weekly_pattern) {
      const activeFromPattern = Object.entries(schedule.weekly_pattern)
        .filter(([_, evts]) => Array.isArray(evts) && evts.length > 0)
        .map(([d, _]) => Number(d));
      if (activeFromPattern.length > 0) return activeFromPattern;
    }
    return [7]; // Default Sunday
  });

  // 4. Multi-Event Routine State
  // Extract initial routine from pattern or metadata
  const [events, setEvents] = useState<ScheduleEventInput[]>(() => {
    if (schedule?.weekly_pattern) {
      // Find the first day with events
      for (const day of [7, 1, 2, 3, 4, 5, 6]) {
        const dayEvts = schedule.weekly_pattern[day] || schedule.weekly_pattern[String(day) as any];
        if (Array.isArray(dayEvts) && dayEvts.length > 0) {
          return dayEvts.map((e: any) => ({
            hour: Number(e.hour || 0),
            minute: Number(e.minute || 0),
            drive: (e.drive || 'ON') as 'ON' | 'OFF',
            mode: (e.mode || 'AUTO') as OperationMode,
            set_temp_f: e.set_temp_f ?? (e.set_temp_c ? Math.round((e.set_temp_c * 9 / 5) + 32) : 70),
            set_temp_c: e.set_temp_c ?? (e.set_temp_f ? Math.round(((e.set_temp_f - 32) * 5 / 9) * 2) / 2 : 21),
            fan_speed: e.fan_speed || 'AUTO',
            air_direction: e.air_direction || 'HORIZONTAL',
            remote_lock: e.remote_lock || 'PERMIT',
          }));
        }
      }
    }
    // Check metadata occupied_start / occupied_end
    if (schedule?.metadata_json?.occupied_start && schedule?.metadata_json?.occupied_end) {
      const [sH, sM] = schedule.metadata_json.occupied_start.split(':').map(Number);
      const [eH, eM] = schedule.metadata_json.occupied_end.split(':').map(Number);
      const tempF = schedule.metadata_json.temperature_f || 70;
      const thermo = schedule.metadata_json.thermostat_adjustments_allowed !== false;
      return [
        {
          hour: sH,
          minute: sM,
          drive: 'ON',
          mode: schedule.metadata_json.mode || 'AUTO',
          set_temp_f: tempF,
          set_temp_c: Math.round(((tempF - 32) * 5 / 9) * 2) / 2,
          remote_lock: thermo ? 'PERMIT' : 'PROHIBIT',
        },
        {
          hour: eH,
          minute: eM,
          drive: 'OFF',
          mode: schedule.metadata_json.mode || 'AUTO',
          set_temp_f: tempF,
          set_temp_c: Math.round(((tempF - 32) * 5 / 9) * 2) / 2,
          remote_lock: thermo ? 'PERMIT' : 'PROHIBIT',
        },
      ];
    }
    // Default template for church service: 07:30 ON, 13:00 OFF
    return [
      {
        hour: 7,
        minute: 30,
        drive: 'ON',
        mode: 'AUTO',
        set_temp_f: 70,
        set_temp_c: 21,
        remote_lock: 'PERMIT',
      },
      {
        hour: 13,
        minute: 0,
        drive: 'OFF',
        mode: 'AUTO',
        set_temp_f: 70,
        set_temp_c: 21,
        remote_lock: 'PERMIT',
      },
    ];
  });

  // Re-sync when schedule prop changes
  useEffect(() => {
    if (schedule) {
      setName(schedule.name || '');
      setColor(schedule.color || 'blue');
      setSeasonId(schedule.season_id || 1);
      setSelectedGroupIds(schedule.assigned_group_ids ? [...schedule.assigned_group_ids] : []);

      // Reconstruct days
      if (schedule.metadata_json?.days && Array.isArray(schedule.metadata_json.days) && schedule.metadata_json.days.length > 0) {
        setSelectedDays([...schedule.metadata_json.days]);
      } else if (schedule.weekly_pattern) {
        const activeFromPattern = Object.entries(schedule.weekly_pattern)
          .filter(([_, evts]) => Array.isArray(evts) && evts.length > 0)
          .map(([d, _]) => Number(d));
        if (activeFromPattern.length > 0) setSelectedDays(activeFromPattern);
      }

      // Reconstruct events
      let foundEvts: ScheduleEventInput[] = [];
      if (schedule.weekly_pattern) {
        for (const day of [7, 1, 2, 3, 4, 5, 6]) {
          const dayEvts = schedule.weekly_pattern[day] || schedule.weekly_pattern[String(day) as any];
          if (Array.isArray(dayEvts) && dayEvts.length > 0) {
            foundEvts = dayEvts.map((e: any) => ({
              hour: Number(e.hour || 0),
              minute: Number(e.minute || 0),
              drive: (e.drive || 'ON') as 'ON' | 'OFF',
              mode: (e.mode || 'AUTO') as OperationMode,
              set_temp_f: e.set_temp_f ?? (e.set_temp_c ? Math.round((e.set_temp_c * 9 / 5) + 32) : 70),
              set_temp_c: e.set_temp_c ?? (e.set_temp_f ? Math.round(((e.set_temp_f - 32) * 5 / 9) * 2) / 2 : 21),
              fan_speed: e.fan_speed || 'AUTO',
              air_direction: e.air_direction || 'HORIZONTAL',
              remote_lock: e.remote_lock || 'PERMIT',
            }));
            break;
          }
        }
      }
      if (foundEvts.length > 0) {
        setEvents(foundEvts);
      }
    } else {
      // New blank schedule
      setName('New Schedule');
      setColor('blue');
      setSeasonId(1);
      setSelectedGroupIds([]);
      setSelectedDays([7]);
      setEvents([
        { hour: 7, minute: 30, drive: 'ON', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 13, minute: 0, drive: 'OFF', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
      ]);
    }
  }, [schedule]);

  const [validationError, setValidationError] = useState<string | null>(null);

  const allGroupIds = useMemo(() => groups.map(g => g.group_id), [groups]);
  const [spaceFilter, setSpaceFilter] = useState<'all' | 'floor1' | 'floor2' | 'lossnay'>('all');

  // Space toggles
  const toggleSpace = (id: number) => {
    setSelectedGroupIds(prev =>
      prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]
    );
  };

  const filteredVisibleGroups = useMemo(() => {
    return groups.filter(g => {
      // 1. Floor/Equipment filter
      if (spaceFilter === 'floor1' && g.floor !== 1) return false;
      if (spaceFilter === 'floor2' && g.floor !== 2) return false;
      if (spaceFilter === 'lossnay' && g.model !== 'LC') return false;

      // 2. Only selected filter
      if (onlySelectedSpaces && !selectedGroupIds.includes(g.group_id)) return false;

      // 3. Search query filter
      if (spaceSearch.trim()) {
        const q = spaceSearch.trim().toLowerCase();
        const displayName = getRoomDisplayName(g).toLowerCase();
        const zoneStr = `zone ${g.group_id}`;
        return displayName.includes(q) || zoneStr.includes(q);
      }

      return true;
    });
  }, [groups, spaceFilter, onlySelectedSpaces, selectedGroupIds, spaceSearch]);

  // Day toggles
  const toggleDay = (dayId: number) => {
    setSelectedDays(prev =>
      prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId].sort()
    );
  };

  // Event handlers
  const handleUpdateEvent = (index: number, patch: Partial<ScheduleEventInput>) => {
    setEvents(prev => {
      const next = [...prev];
      const updated = { ...next[index], ...patch };
      // Keep temp units synced
      if (patch.set_temp_f !== undefined && patch.set_temp_c === undefined) {
        updated.set_temp_c = Math.round(((patch.set_temp_f - 32) * 5 / 9) * 2) / 2;
      } else if (patch.set_temp_c !== undefined && patch.set_temp_f === undefined) {
        updated.set_temp_f = Math.round((patch.set_temp_c * 9 / 5) + 32);
      }
      next[index] = updated;
      return next.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    });
  };

  const handleAddEvent = () => {
    if (events.length >= 16) {
      setValidationError('Maximum 16 events allowed per schedule day by controller EEPROM.');
      return;
    }
    // Calculate logical next event time
    let nextH = 8;
    let nextM = 0;
    let nextDrive: 'ON' | 'OFF' = 'ON';

    if (events.length > 0) {
      const last = events[events.length - 1];
      const lastMin = last.hour * 60 + last.minute;
      const targetMin = Math.min(1410, lastMin + 180); // 3 hours later
      nextH = Math.floor(targetMin / 60);
      nextM = targetMin % 60;
      nextDrive = last.drive === 'ON' ? 'OFF' : 'ON';
    }

    const newEv: ScheduleEventInput = {
      hour: nextH,
      minute: nextM,
      drive: nextDrive,
      mode: 'AUTO',
      set_temp_f: 70,
      set_temp_c: 21,
      remote_lock: 'PERMIT',
    };
    setEvents(prev => [...prev, newEv].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute)));
  };

  const handleDeleteEvent = (index: number) => {
    setEvents(prev => prev.filter((_, idx) => idx !== index));
  };

  // Presets
  const applyPreset = (kind: 'sunday' | 'office' | 'evening' | 'allday') => {
    if (kind === 'sunday') {
      setSelectedDays([7]);
      setEvents([
        { hour: 7, minute: 30, drive: 'ON', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 13, minute: 0, drive: 'OFF', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 17, minute: 30, drive: 'ON', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 20, minute: 30, drive: 'OFF', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
      ]);
    } else if (kind === 'office') {
      setSelectedDays([1, 2, 3, 4, 5]);
      setEvents([
        { hour: 8, minute: 0, drive: 'ON', mode: 'AUTO', set_temp_f: 72, set_temp_c: 22, remote_lock: 'PERMIT' },
        { hour: 17, minute: 0, drive: 'OFF', mode: 'AUTO', set_temp_f: 72, set_temp_c: 22, remote_lock: 'PERMIT' },
      ]);
    } else if (kind === 'evening') {
      setSelectedDays([3]); // Wednesday
      setEvents([
        { hour: 17, minute: 30, drive: 'ON', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 21, minute: 0, drive: 'OFF', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
      ]);
    } else if (kind === 'allday') {
      setSelectedDays([1, 2, 3, 4, 5, 6, 7]);
      setEvents([
        { hour: 6, minute: 0, drive: 'ON', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
        { hour: 22, minute: 0, drive: 'OFF', mode: 'AUTO', set_temp_f: 70, set_temp_c: 21, remote_lock: 'PERMIT' },
      ]);
    }
  };

  // Compile weekly pattern for all 7 days
  const compiledWeeklyPattern = useMemo(() => {
    const pat: Record<number, ScheduleEventInput[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    selectedDays.forEach(d => {
      pat[d] = events.map(e => ({
        hour: e.hour,
        minute: e.minute,
        time_str: `${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}`,
        drive: e.drive,
        mode: e.mode || 'AUTO',
        set_temp_f: e.set_temp_f || 70,
        set_temp_c: e.set_temp_c || 21,
        fan_speed: e.fan_speed || 'AUTO',
        air_direction: e.air_direction || 'HORIZONTAL',
        remote_lock: e.remote_lock || 'PERMIT',
      }));
    });
    return pat;
  }, [selectedDays, events]);

  // Conflict detection
  const conflicts: ConflictDetail[] = useMemo(() => {
    if (events.length === 0 || selectedGroupIds.length === 0 || selectedDays.length === 0) return [];

    const firstOn = events.find(e => e.drive === 'ON');
    const lastOff = [...events].reverse().find(e => e.drive === 'OFF') || events[events.length - 1];

    const startStr = firstOn ? `${String(firstOn.hour).padStart(2, '0')}:${String(firstOn.minute).padStart(2, '0')}` : '08:00';
    const endStr = lastOff ? `${String(lastOff.hour).padStart(2, '0')}:${String(lastOff.minute).padStart(2, '0')}` : '17:00';

    return detectScheduleConflicts(
      schedule?.id,
      selectedGroupIds,
      selectedDays,
      startStr,
      endStr,
      allPrograms,
      groups,
      name
    );
  }, [schedule?.id, selectedGroupIds, selectedDays, events, allPrograms, groups, name]);

  // Validation & Save
  const handleSaveClick = async (flashToHardware: boolean) => {
    if (!name.trim()) {
      setValidationError('Please enter a schedule name.');
      return;
    }
    if (selectedGroupIds.length === 0) {
      setValidationError('Please select at least one room or space.');
      return;
    }
    if (selectedDays.length === 0) {
      setValidationError('Please select at least one active day of the week.');
      return;
    }
    if (events.length === 0) {
      setValidationError('Please add at least one timer event (e.g. Turn ON).');
      return;
    }

    setValidationError(null);

    const firstOn = events.find(e => e.drive === 'ON');
    const lastOff = [...events].reverse().find(e => e.drive === 'OFF') || events[events.length - 1];
    const occStart = firstOn ? `${String(firstOn.hour).padStart(2, '0')}:${String(firstOn.minute).padStart(2, '0')}` : '08:00';
    const occEnd = lastOff ? `${String(lastOff.hour).padStart(2, '0')}:${String(lastOff.minute).padStart(2, '0')}` : '17:00';
    const avgTempF = firstOn?.set_temp_f || 70;

    const payload = {
      id: schedule?.id,
      name: name.trim(),
      description: `${events.length} event routine across ${selectedDays.length} days`,
      color,
      season_id: seasonId,
      season_scope: [String(seasonId)],
      weekly_pattern: compiledWeeklyPattern,
      assigned_group_ids: selectedGroupIds,
      metadata_json: {
        occupied_start: occStart,
        occupied_end: occEnd,
        temperature_f: avgTempF,
        mode: firstOn?.mode || 'AUTO',
        thermostat_adjustments_allowed: events.every(e => e.remote_lock !== 'PROHIBIT'),
        days: selectedDays,
        recurrence_kind: 'weekly',
        status: 'published',
      },
    };

    await onSave(payload, flashToHardware);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      {/* Top Header & Immediate Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
              {isNew ? 'New Schedule' : `Schedule #${schedule?.id}`}
            </span>
            <span className="text-xs text-slate-400">
              {compactSpaceSummary(selectedGroupIds, groups)}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {name || 'Untitled Schedule'}
          </h2>
        </div>

        {/* Save & Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition"
            >
              Cancel
            </button>
          )}

          {onDelete && schedule && schedule.id && (
            <button
              type="button"
              onClick={() => onDelete(schedule)}
              className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-semibold border border-red-500/30 transition flex items-center gap-1.5"
              title="Delete this schedule"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleSaveClick(false)}
            disabled={isSaving}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 shadow transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Draft</span>
          </button>

          <button
            type="button"
            onClick={() => handleSaveClick(true)}
            disabled={isSaving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/25 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>Save &amp; Flash to Controller</span>
          </button>
        </div>
      </div>

      {/* Flashing / Syncing Streaming Progress */}
      {publishProgress && (
        <div className="bg-slate-950 border border-blue-500/40 rounded-xl p-4 shadow-lg space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-blue-300 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Writing Schedule EEPROM Registers ({publishProgress.current} / {publishProgress.total} spaces)
            </span>
            <span className="text-emerald-400">{publishProgress.percent}% Complete</span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-300"
              style={{ width: `${publishProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Validation Alert */}
      {validationError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Conflict Alert (Informative Non-blocking) */}
      {conflicts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1 text-xs text-amber-300">
          <div className="flex items-center gap-2 font-bold text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Overlapping Schedule Note ({conflicts.length}):</span>
          </div>
          <p className="text-[11px] text-amber-400/90 pl-6">
            The following rooms also run other schedules on the same days and times:
          </p>
          <ul className="list-disc pl-10 text-[11px] text-amber-300/80 space-y-0.5">
            {conflicts.slice(0, 3).map((c, i) => (
              <li key={i}>
                <strong>{c.roomName}</strong> has "{c.conflictingProgramName}" on {c.dayName} ({c.timeRange}).
              </li>
            ))}
            {conflicts.length > 3 && (
              <li>...and {conflicts.length - 3} other overlap(s). The controller hardware merges active ON intervals automatically.</li>
            )}
          </ul>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 1: IDENTITY (NAME, COLOR, SEASON) */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Name */}
        <div className="space-y-1 md:col-span-2">
          <label className="block text-xs font-semibold text-slate-300">Schedule Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (validationError) setValidationError(null);
            }}
            placeholder="e.g. Sunday Worship, Staff Meeting, or Office Hours"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Season */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-300">Active Season</label>
          <select
            value={seasonId}
            onChange={(e) => setSeasonId(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {seasons.map(s => (
              <option key={s.season_id} value={s.season_id}>
                {s.name} ({s.start_month}/{s.start_day}–{s.end_month}/{s.end_day})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Color Picker Swatches */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-400">Accent Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {COLOR_OPTIONS.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setColor(c.id)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${c.badge} ${
                color === c.id ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 shadow-md' : 'opacity-70 hover:opacity-100'
              }`}
            >
              {color === c.id && <CheckCircle2 className="w-3 h-3" />}
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: ASSIGNED ROOMS / SPACES (COLLAPSIBLE / SEARCHABLE) */}
      {/* ========================================================================= */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span>Target Spaces</span>
              <span className="text-blue-400 font-normal">
                ({selectedGroupIds.length} of {groups.length} selected)
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Select which controller zones will follow this schedule routine.
            </p>
          </div>

          {/* Quick Tools */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedGroupIds(allGroupIds)}
              className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
            >
              Select All ({allGroupIds.length})
            </button>
            <span className="text-slate-700">·</span>
            <button
              type="button"
              onClick={() => setOnlySelectedSpaces(!onlySelectedSpaces)}
              className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
            >
              {onlySelectedSpaces ? 'Show All Spaces' : 'Only Show Selected'}
            </button>
            <span className="text-slate-700">·</span>
            <button
              type="button"
              onClick={() => setSelectedGroupIds([])}
              className="text-[11px] text-slate-400 hover:text-slate-300 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Space Search and Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Filter spaces by controller name..."
            value={spaceSearch}
            onChange={(e) => setSpaceSearch(e.target.value)}
            className="flex-1 min-w-[200px] bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setSpaceFilter('all')}
              className={`px-2 py-1 rounded-md transition ${spaceFilter === 'all' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSpaceFilter('floor1')}
              className={`px-2 py-1 rounded-md transition ${spaceFilter === 'floor1' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Floor 1
            </button>
            <button
              type="button"
              onClick={() => setSpaceFilter('floor2')}
              className={`px-2 py-1 rounded-md transition ${spaceFilter === 'floor2' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Floor 2
            </button>
            <button
              type="button"
              onClick={() => setSpaceFilter('lossnay')}
              className={`px-2 py-1 rounded-md transition ${spaceFilter === 'lossnay' ? 'bg-blue-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Lossnay
            </button>
          </div>
        </div>

        {/* Spaces Direct Grid */}
        <div className="max-h-60 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {filteredVisibleGroups.map(g => {
              const isChecked = selectedGroupIds.includes(g.group_id);
              const displayName = getRoomDisplayName(g);
              return (
                <label
                  key={g.group_id}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer flex items-center gap-2 transition select-none ${
                    isChecked
                      ? 'bg-blue-600/15 border-blue-500 text-blue-200 font-semibold'
                      : 'bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSpace(g.group_id)}
                    className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer shrink-0"
                  />
                  <span className="truncate" title={displayName}>{displayName}</span>
                </label>
              );
            })}
          </div>
          {filteredVisibleGroups.length === 0 && (
            <div className="text-center py-6 text-xs text-slate-500">
              No spaces match the current filter.
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: ACTIVE DAYS OF THE WEEK */}
      {/* ========================================================================= */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Active Days ({formatDaysSummary(selectedDays)})
            </label>
            <p className="text-[11px] text-slate-500">
              The daily event routine below runs on each selected day.
            </p>
          </div>

          {/* Presets */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedDays([7])}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Sunday Only
            </button>
            <button
              type="button"
              onClick={() => setSelectedDays([3])}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Wednesday Only
            </button>
            <button
              type="button"
              onClick={() => setSelectedDays([1, 2, 3, 4, 5])}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Weekdays
            </button>
            <button
              type="button"
              onClick={() => setSelectedDays([1, 2, 3, 4, 5, 6, 7])}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              All Week
            </button>
          </div>
        </div>

        {/* 7 Days Pills */}
        <div className="grid grid-cols-7 gap-1.5">
          {DAYS_OF_WEEK.map(d => {
            const isSelected = selectedDays.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDay(d.id)}
                className={`py-2 px-1 rounded-xl text-xs font-bold border transition ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>{d.short}</span>
                  {d.highlight && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 4: MULTI-EVENT DAILY ROUTINE & 24H VISUAL TIMELINE */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-2 border-t border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>Daily Event Routine ({events.length} Events)</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Multiple events per day. HVAC equipment automatically follows this cycle.
            </p>
          </div>

          {/* Presets & Add Event */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-[10px] font-medium">
              <button
                type="button"
                onClick={() => applyPreset('sunday')}
                className="px-2 py-0.5 text-slate-400 hover:text-white transition"
                title="7:30am-1pm & 5:30pm-8:30pm"
              >
                Morning &amp; Evening
              </button>
              <button
                type="button"
                onClick={() => applyPreset('office')}
                className="px-2 py-0.5 text-slate-400 hover:text-white transition"
                title="8:00am-5:00pm"
              >
                Standard Day
              </button>
              <button
                type="button"
                onClick={() => applyPreset('allday')}
                className="px-2 py-0.5 text-slate-400 hover:text-white transition"
                title="6:00am-10:00pm"
              >
                All-Day
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddEvent}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Event</span>
            </button>
          </div>
        </div>

        {/* 24-Hour Visual Timeline Preview */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-2 text-[11px]">
            <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
              24-Hour Cycle Footprint
            </span>
            <span className="text-emerald-400 font-semibold">
              Live Preview
            </span>
          </div>
          <ScheduleTimelineBar events={events} tempUnit={tempUnit} />
        </div>

        {/* Chronological Event Rows */}
        <div className="space-y-2">
          {events.map((ev, index) => {
            const isOff = ev.drive === 'OFF';
            const isOn = !isOff;
            const tempVal = tempUnit === 'F' ? (ev.set_temp_f || 70) : (ev.set_temp_c || 21);

            return (
              <div
                key={index}
                className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 transition ${
                  isOn ? 'bg-slate-950/90 border-emerald-500/30' : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                {/* Event Time & Power Toggle */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Time Pickers */}
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                    <select
                      value={ev.hour}
                      onChange={(e) => handleUpdateEvent(index, { hour: Number(e.target.value) })}
                      className="bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {Array.from({ length: 24 }).map((_, h) => (
                        <option key={h} value={h} className="bg-slate-900 text-slate-200">
                          {String(h).padStart(2, '0')} ({h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`})
                        </option>
                      ))}
                    </select>
                    <span className="text-slate-500 font-mono">:</span>
                    <select
                      value={ev.minute}
                      onChange={(e) => handleUpdateEvent(index, { minute: Number(e.target.value) })}
                      className="bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                        <option key={m} value={m} className="bg-slate-900 text-slate-200">
                          {String(m).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Power Button */}
                  <div className="flex rounded-lg border border-slate-800 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => handleUpdateEvent(index, { drive: 'ON' })}
                      className={`px-3 py-1 font-bold transition ${
                        isOn ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      TURN ON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateEvent(index, { drive: 'OFF' })}
                      className={`px-3 py-1 font-bold transition ${
                        isOff ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      TURN OFF
                    </button>
                  </div>
                </div>

                {/* Conditioning Parameters (If ON) */}
                {isOn ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Mode */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Mode:</span>
                      <select
                        value={ev.mode || 'AUTO'}
                        onChange={(e) => handleUpdateEvent(index, { mode: e.target.value as OperationMode })}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        <option value="AUTO">AUTO</option>
                        <option value="HEAT">HEAT</option>
                        <option value="COOL">COOL</option>
                        <option value="FAN">FAN</option>
                        <option value="DRY">DRY</option>
                      </select>
                    </div>

                    {/* Target Temp */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Temp:</span>
                      <input
                        type="number"
                        min={tempUnit === 'F' ? 60 : 16}
                        max={tempUnit === 'F' ? 86 : 30}
                        step={tempUnit === 'F' ? 1 : 0.5}
                        value={tempVal}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (tempUnit === 'F') {
                            handleUpdateEvent(index, { set_temp_f: val });
                          } else {
                            handleUpdateEvent(index, { set_temp_c: val });
                          }
                        }}
                        className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-emerald-300 font-mono font-bold focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-xs font-bold text-slate-400">°{tempUnit}</span>
                    </div>

                    {/* Wall Remote Permission */}
                    <button
                      type="button"
                      onClick={() => handleUpdateEvent(index, {
                        remote_lock: ev.remote_lock === 'PROHIBIT' ? 'PERMIT' : 'PROHIBIT'
                      })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1 transition ${
                        ev.remote_lock === 'PROHIBIT'
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                      title={ev.remote_lock === 'PROHIBIT' ? 'Wall keypads locked' : 'Occupants can adjust setpoint ±2°F'}
                    >
                      {ev.remote_lock === 'PROHIBIT' ? (
                        <>
                          <Lock className="w-3 h-3 text-amber-400" />
                          <span>Locked</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3 text-emerald-400" />
                          <span>Unlocked</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 italic">
                    HVAC shutdown / standby setback block
                  </span>
                )}

                {/* Delete Event Button */}
                <button
                  type="button"
                  onClick={() => handleDeleteEvent(index)}
                  disabled={events.length <= 1}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-red-400 rounded-lg transition disabled:opacity-30"
                  title="Remove this event"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
