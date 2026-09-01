import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  Plus, 
  Trash2, 
  Save, 
  Layers, 
  Copy, 
  CheckCircle2, 
  RefreshCw,
  Edit2,
  X,
  Info
} from 'lucide-react';
import { 
  GroupStatus, 
  ScheduleItem, 
  ScheduleEventInput, 
  OperationMode, 
  FanSpeed 
} from '../types';
import { 
  fetchWeeklySchedule, 
  updateWeeklySchedule
} from '../api';
import { useAuth } from '../AuthContext';

interface ScheduleViewProps {
  groups: GroupStatus[];
  tempUnit: 'F' | 'C';
  activeMode?: ScheduleMode;
  onModeChange?: (mode: ScheduleMode) => void;
}

type ScheduleMode = 'planner' | 'matrix';

const DAYS_OF_WEEK = [
  { id: 7, label: 'Sunday', short: 'Sun', highlight: true },
  { id: 1, label: 'Monday', short: 'Mon' },
  { id: 2, label: 'Tuesday', short: 'Tue' },
  { id: 3, label: 'Wednesday', short: 'Wed', highlight: true },
  { id: 4, label: 'Thursday', short: 'Thu' },
  { id: 5, label: 'Friday', short: 'Fri' },
  { id: 6, label: 'Saturday', short: 'Sat' },
];

export const ScheduleView: React.FC<ScheduleViewProps> = ({ 
  groups, 
  tempUnit,
  activeMode,
  onModeChange,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(activeMode || 'planner');

  useEffect(() => {
    if (activeMode && activeMode !== scheduleMode) {
      setScheduleMode(activeMode);
    }
  }, [activeMode]);

  const handleSetMode = (mode: ScheduleMode) => {
    setScheduleMode(mode);
    onModeChange?.(mode);
  };

  // Mode 1 (Planner) & Mode 2 (Matrix) state
  const [selectedDay, setSelectedDay] = useState<number>(7); // Default Sunday
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(() => 
    groups.length > 0 ? [groups[0].group_id] : [1]
  );
  const [primaryGroupId, setPrimaryGroupId] = useState<number>(() => 
    groups.length > 0 ? groups[0].group_id : 1
  );
  
  // Weekly Patterns Cache: group_id -> day (1..7) -> ScheduleItem[]
  const [weeklyPatterns, setWeeklyPatterns] = useState<Record<number, Record<number, ScheduleItem[]>>>({});
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'floor1' | 'floor2' | 'ventilation'>('all');
  
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Modals state
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState<ScheduleEventInput>({
    hour: 7,
    minute: 0,
    drive: 'ON',
    mode: 'AUTO',
    set_temp_f: 70.0,
    set_temp_c: 21.1,
    fan_speed: 'AUTO',
    air_direction: 'HORIZONTAL',
  });

  // Day Duplicate Modal
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateTargetDays, setDuplicateTargetDays] = useState<number[]>([]);

  // Load weekly schedule for a single group or batch
  const loadWeeklyScheduleForGroup = async (groupId: number) => {
    try {
      const data = await fetchWeeklySchedule(groupId);
      setWeeklyPatterns((prev) => ({
        ...prev,
        [groupId]: data,
      }));
    } catch (err) {
      console.error(`Failed to load weekly schedule for group ${groupId}:`, err);
    }
  };

  // Pre-load schedules for initial selection and matrix
  useEffect(() => {
    loadWeeklyScheduleForGroup(primaryGroupId);
  }, [primaryGroupId]);

  const loadAllMatrixSchedules = async () => {
    setLoading(true);
    try {
      for (const g of groups) {
        if (!weeklyPatterns[g.group_id]) {
          await loadWeeklyScheduleForGroup(g.group_id);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (scheduleMode === 'matrix') {
      loadAllMatrixSchedules();
    }
  }, [scheduleMode]);

  // Current day events for the primary selected group in Planner mode
  const currentDayEvents: ScheduleItem[] = 
    weeklyPatterns[primaryGroupId]?.[selectedDay] || [];

  // --- Helper Zone Filter Presets ---
  const applyZoneFilter = (preset: 'floor1' | 'floor2' | 'lossnay' | 'all' | 'clear') => {
    if (preset === 'floor1') {
      const f1 = groups.filter((g) => g.floor === 1 || ((g as { floor?: number }).floor ?? 1) === 1).map((g) => g.group_id);
      setSelectedGroupIds(f1);
      if (f1.length) setPrimaryGroupId(f1[0]);
    } else if (preset === 'floor2') {
      const f2 = groups.filter((g) => g.floor === 2 || ((g as { floor?: number }).floor ?? 1) === 2).map((g) => g.group_id);
      setSelectedGroupIds(f2);
      if (f2.length) setPrimaryGroupId(f2[0]);
    } else if (preset === 'lossnay') {
      const lossnays = groups.filter((g) => g.model === 'LC').map((g) => g.group_id);
      setSelectedGroupIds(lossnays);
      if (lossnays.length) setPrimaryGroupId(lossnays[0]);
    } else if (preset === 'all') {
      const all = groups.map((g) => g.group_id);
      setSelectedGroupIds(all);
      if (all.length) setPrimaryGroupId(all[0]);
    } else if (preset === 'clear') {
      setSelectedGroupIds([]);
    }
  };

  const toggleZoneId = (id: number) => {
    setSelectedGroupIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length > 0 && !next.includes(primaryGroupId)) {
        setPrimaryGroupId(next[0]);
      }
      return next;
    });
  };

  // --- Event Editing Handlers ---
  const handleOpenAddEvent = () => {
    setEditingEventIndex(null);
    setEventForm({
      hour: 7,
      minute: 0,
      drive: 'ON',
      mode: 'AUTO',
      set_temp_f: 70.0,
      set_temp_c: 21.1,
      fan_speed: 'AUTO',
      air_direction: 'HORIZONTAL',
    });
    setIsEventModalOpen(true);
  };

  const handleOpenEditEvent = (idx: number, item: ScheduleItem) => {
    setEditingEventIndex(idx);
    setEventForm({
      hour: item.hour,
      minute: item.minute,
      drive: item.drive === 'OFF' ? 'OFF' : 'ON',
      mode: item.mode || 'AUTO',
      set_temp_f: item.set_temp_f ?? 70.0,
      set_temp_c: item.set_temp_c ?? 21.1,
      fan_speed: item.fan_speed || 'AUTO',
      air_direction: item.air_direction || 'HORIZONTAL',
    });
    setIsEventModalOpen(true);
  };

  const handleSaveEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const timeStr = `${String(eventForm.hour).padStart(2, '0')}:${String(eventForm.minute).padStart(2, '0')}`;
    const newItem: ScheduleItem = {
      index: editingEventIndex !== null ? editingEventIndex + 1 : currentDayEvents.length + 1,
      hour: eventForm.hour,
      minute: eventForm.minute,
      drive: eventForm.drive,
      mode: eventForm.drive === 'ON' ? eventForm.mode : undefined,
      set_temp_f: eventForm.drive === 'ON' ? eventForm.set_temp_f : undefined,
      set_temp_c: eventForm.drive === 'ON' ? eventForm.set_temp_c : undefined,
      fan_speed: eventForm.drive === 'ON' ? eventForm.fan_speed : undefined,
      air_direction: eventForm.drive === 'ON' ? eventForm.air_direction : undefined,
      time_str: timeStr,
    };

    let updatedList = [...currentDayEvents];
    if (editingEventIndex !== null) {
      updatedList[editingEventIndex] = newItem;
    } else {
      updatedList.push(newItem);
    }

    // Sort events chronologically
    updatedList.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    // Re-index
    updatedList = updatedList.map((item, i) => ({ ...item, index: i + 1 }));

    // Update local state
    setWeeklyPatterns((prev) => ({
      ...prev,
      [primaryGroupId]: {
        ...(prev[primaryGroupId] || {}),
        [selectedDay]: updatedList,
      },
    }));

    setIsEventModalOpen(false);
  };

  const handleDeleteEvent = (idx: number) => {
    let updatedList = currentDayEvents.filter((_, i) => i !== idx);
    updatedList = updatedList.map((item, i) => ({ ...item, index: i + 1 }));
    setWeeklyPatterns((prev) => ({
      ...prev,
      [primaryGroupId]: {
        ...(prev[primaryGroupId] || {}),
        [selectedDay]: updatedList,
      },
    }));
  };

  // --- Duplicate Day Handler ---
  const handleExecuteDuplicate = () => {
    if (duplicateTargetDays.length === 0) return;
    const sourceEvents = [...currentDayEvents];

    setWeeklyPatterns((prev) => {
      const groupData = { ...(prev[primaryGroupId] || {}) };
      duplicateTargetDays.forEach((dayId) => {
        groupData[dayId] = sourceEvents.map((ev) => ({ ...ev }));
      });
      return {
        ...prev,
        [primaryGroupId]: groupData,
      };
    });

    setIsDuplicateModalOpen(false);
    setStatusMsg(`Duplicated ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} schedule to ${duplicateTargetDays.length} other days.`);
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // --- Save Day to Selected Zones (Planner Mode) ---
  const handleSavePlannerToHardware = async () => {
    if (selectedGroupIds.length === 0) return;
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const payloadEvents: ScheduleEventInput[] = currentDayEvents.map((ev) => ({
        hour: ev.hour,
        minute: ev.minute,
        drive: ev.drive === 'OFF' ? 'OFF' : 'ON',
        mode: ev.mode,
        set_temp_f: ev.set_temp_f,
        set_temp_c: ev.set_temp_c,
        fan_speed: ev.fan_speed,
        air_direction: ev.air_direction,
      }));

      const res = await updateWeeklySchedule(
        selectedGroupIds,
        selectedDay,
        payloadEvents
      );

      // Update all selected groups in local state
      setWeeklyPatterns((prev) => {
        const next = { ...prev };
        selectedGroupIds.forEach((gid) => {
          next[gid] = {
            ...(next[gid] || {}),
            [selectedDay]: currentDayEvents.map((ev) => ({ ...ev })),
          };
        });
        return next;
      });

      setStatusMsg(res.message || `Successfully saved ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} schedule to ${selectedGroupIds.length} zones.`);
    } catch (err: any) {
      setStatusMsg(`Error saving to controller: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Filter for Matrix view
  const filteredMatrixGroups = groups.filter((g) => {
    if (matrixFilter === 'floor1') return (g.floor === 1 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 1));
    if (matrixFilter === 'floor2') return (g.floor === 2 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 2));
    if (matrixFilter === 'ventilation') return g.model === 'LC';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header & 2-Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20 font-mono">
              GB-50 Weekly Timer & Schedules
            </span>
            <span>Centralized Controller</span>
          </div>
          <h2 className="text-xl font-extrabold text-white mt-1">HVAC Weekly Schedule Management</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Program 24-hour weekly event patterns and multi-zone schedule matrices written directly to controller memory.
          </p>
        </div>

        {/* 2 Switchable View Mode Buttons */}
        <div className="flex items-center bg-slate-950 border border-slate-800 p-1.5 rounded-2xl shadow-inner gap-1">
          <button
            onClick={() => handleSetMode('planner')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition ${
              scheduleMode === 'planner'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> Weekly Timeline Planner
          </button>

          <button
            onClick={() => handleSetMode('matrix')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition ${
              scheduleMode === 'matrix'
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Master Matrix Grid
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3.5 bg-blue-500/10 border border-blue-500/30 rounded-2xl text-xs font-semibold text-blue-300 flex items-center gap-2 shadow">
          <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {!isAdmin && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs font-semibold text-amber-300 flex items-center gap-2 shadow">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Viewing active schedules in Read-Only mode. Modifying or saving schedules to the controller requires Administrator permissions.</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 1: WEEKLY VISUAL PLANNER (TIMELINE & ZONE SELECTOR) */}
      {/* ========================================================================= */}
      {scheduleMode === 'planner' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-2xl">
          {/* Step 1: Target Zone Selection Bar */}
          <div className="space-y-3 border-b border-slate-800 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                🎯 Step 1: Select Target HVAC Zones ({selectedGroupIds.length} Selected)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => applyZoneFilter('all')}
                  className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-xs font-bold rounded-lg text-blue-300 border border-blue-500/30"
                >
                  All Zones ({groups.length})
                </button>
                <button
                  onClick={() => applyZoneFilter('floor1')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 border border-slate-700"
                >
                  Floor 1 ({groups.filter(g => g.floor === 1 || ((g as { floor?: number }).floor ?? 1) === 1).length})
                </button>
                <button
                  onClick={() => applyZoneFilter('floor2')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 border border-slate-700"
                >
                  Floor 2 ({groups.filter(g => g.floor === 2 || ((g as { floor?: number }).floor ?? 1) === 2).length})
                </button>
                <button
                  onClick={() => applyZoneFilter('lossnay')}
                  className="px-3 py-1 bg-teal-600/20 hover:bg-teal-600/30 text-xs font-semibold rounded-lg text-teal-300 border border-teal-500/30"
                >
                  LOSSNAY HRUs ({groups.filter(g => g.model === 'LC').length})
                </button>
                <button
                  onClick={() => applyZoneFilter('clear')}
                  className="px-3 py-1 bg-slate-800/60 hover:bg-slate-800 text-xs font-semibold rounded-lg text-slate-400 border border-slate-700"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            {/* Zone Multi-Select Chips */}
            <div className="flex flex-wrap gap-2 pt-1 max-h-32 overflow-y-auto p-1.5 bg-slate-950/70 rounded-2xl border border-slate-800/80">
              {groups.map((g) => {
                const isSelected = selectedGroupIds.includes(g.group_id);
                return (
                  <button
                    key={g.group_id}
                    onClick={() => toggleZoneId(g.group_id)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition border flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                    }`}
                  >
                    <span>{isSelected ? '✓' : ''} {g.name}</span>
                    <span className="text-[10px] opacity-70 font-mono">#{g.group_id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Day of Week Selector Bar */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                📅 Step 2: Choose Day to Program
              </span>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                Currently Viewing: {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} ({currentDayEvents.length} Events)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = selectedDay === day.id;
                const count = weeklyPatterns[primaryGroupId]?.[day.id]?.length || 0;
                return (
                  <button
                    key={day.id}
                    onClick={() => setSelectedDay(day.id)}
                    className={`p-3 rounded-2xl font-bold text-xs text-center border transition ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-900/40'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                    }`}
                  >
                    <div className="text-sm font-black">{day.short.toUpperCase()}</div>
                    <div className="text-[10px] font-mono opacity-80 mt-0.5">
                      {count > 0 ? `${count} Event${count > 1 ? 's' : ''}` : 'Off / Unoccupied'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3: Visual 24-Hour Day Timeline */}
          <div className="space-y-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} 24-Hour Visual Schedule
                </h3>
                <p className="text-[11px] text-slate-400">
                  Green/Blue = Active Conditioning Running • Slate = System Power OFF
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!isAdmin) return;
                    setDuplicateTargetDays([1, 2, 3, 4, 5].filter(d => d !== selectedDay));
                    setIsDuplicateModalOpen(true);
                  }}
                  disabled={!isAdmin}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-xl border flex items-center gap-1.5 ${
                    !isAdmin
                      ? 'bg-slate-800/40 text-slate-500 border-slate-800 cursor-not-allowed'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title={!isAdmin ? 'Admin permissions required to duplicate schedules' : undefined}
                >
                  <Copy className="w-3.5 h-3.5 text-blue-400" /> Duplicate Day to...
                </button>

                {isAdmin && (
                  <button
                    onClick={handleOpenAddEvent}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl text-white shadow flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Scheduled Event
                  </button>
                )}
              </div>
            </div>

            {/* Timeline Visual Bar */}
            <div className="relative h-12 bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex">
              {currentDayEvents.length > 0 ? (
                (() => {
                  // Render visual segments based on events
                  const segments: React.ReactNode[] = [];
                  let prevMinute = 0;
                  let prevDrive = 'OFF';
                  let prevTemp = 70;

                  currentDayEvents.forEach((ev, i) => {
                    const currentMinute = ev.hour * 60 + ev.minute;
                    const duration = currentMinute - prevMinute;
                    if (duration > 0) {
                      const widthPercent = (duration / 1440) * 100;
                      segments.push(
                        <div
                          key={`seg-${i}`}
                          style={{ width: `${widthPercent}%` }}
                          className={`h-full flex flex-col items-center justify-center text-[10px] font-mono border-r border-slate-800/60 overflow-hidden ${
                            prevDrive === 'ON'
                              ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                              : 'bg-slate-900/90 text-slate-500'
                          }`}
                          title={`${prevDrive === 'ON' ? `Active (${prevTemp}°F)` : 'OFF'}`}
                        >
                          {widthPercent > 8 && (
                            <span>{prevDrive === 'ON' ? `ON ${prevTemp}°F` : 'OFF'}</span>
                          )}
                        </div>
                      );
                    }
                    prevMinute = currentMinute;
                    prevDrive = ev.drive || 'OFF';
                    prevTemp = ev.set_temp_f || 70;
                  });

                  // Final segment to end of day (1440 min)
                  if (prevMinute < 1440) {
                    const duration = 1440 - prevMinute;
                    const widthPercent = (duration / 1440) * 100;
                    segments.push(
                      <div
                        key="seg-final"
                        style={{ width: `${widthPercent}%` }}
                        className={`h-full flex flex-col items-center justify-center text-[10px] font-mono overflow-hidden ${
                          prevDrive === 'ON'
                            ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                            : 'bg-slate-900/90 text-slate-500'
                        }`}
                      >
                        {widthPercent > 8 && (
                          <span>{prevDrive === 'ON' ? `ON ${prevTemp}°F` : 'OFF'}</span>
                        )}
                      </div>
                    );
                  }

                  return segments;
                })()
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 font-mono">
                  No scheduled events for this day (System stays OFF)
                </div>
              )}
            </div>

            {/* Time Markers */}
            <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1">
              <span>12 AM</span>
              <span>3 AM</span>
              <span>6 AM</span>
              <span>9 AM</span>
              <span>12 PM</span>
              <span>3 PM</span>
              <span>6 PM</span>
              <span>9 PM</span>
              <span>12 AM</span>
            </div>

            {/* Event List Cards */}
            {currentDayEvents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {currentDayEvents.map((item, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-2xl p-4 flex items-center justify-between transition ${
                      item.drive === 'ON'
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-slate-900/80 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`px-3 py-1.5 rounded-xl font-mono font-extrabold text-xs shadow-sm ${
                          item.drive === 'ON'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {String(item.hour).padStart(2, '0')}:{String(item.minute).padStart(2, '0')}
                      </div>

                      <div>
                        <h4 className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                          {item.drive === 'ON' ? (
                            <span className="text-emerald-400">Power ON & Condition</span>
                          ) : (
                            <span className="text-rose-400">Power OFF (Shutdown)</span>
                          )}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {item.drive === 'ON' ? (
                            <span>
                              Mode: <strong className="text-white">{item.mode || 'AUTO'}</strong> • Temp: <strong className="text-emerald-300 font-mono">{item.set_temp_f}°F</strong> • Fan: <strong className="text-white">{item.fan_speed || 'AUTO'}</strong>
                            </span>
                          ) : (
                            <span>System shut down until next active event</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditEvent(idx, item)}
                          className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition text-xs"
                          title="Edit event"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(idx)}
                          className="p-2 hover:bg-rose-950/60 rounded-xl text-slate-400 hover:text-rose-400 transition text-xs"
                          title="Delete event"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-slate-500">
                {isAdmin ? (
                  <span>Click <strong>+ Add Scheduled Event</strong> above to create times and setpoints for this day.</span>
                ) : (
                  <span>No scheduled events programmed for this day.</span>
                )}
              </div>
            )}
          </div>

          {/* Step 4: Save to Hardware Button */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-slate-800 pt-5">
            <div className="text-xs text-slate-400">
              Will update <strong className="text-white">{DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Schedule</strong> across{' '}
              <strong className="text-blue-400">{selectedGroupIds.length} Selected Zones</strong> in a single batch request.
            </div>

            <button
              onClick={handleSavePlannerToHardware}
              disabled={!isAdmin || isSaving || selectedGroupIds.length === 0}
              className={`px-6 py-2.5 font-bold text-xs rounded-xl transition flex items-center gap-2 ${
                !isAdmin
                  ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950 disabled:opacity-40'
              }`}
              title={!isAdmin ? 'Admin permissions required to save schedules to hardware' : undefined}
            >
              <Save className="w-4 h-4" />
              {isSaving
                ? 'Saving to Controller...'
                : `Save ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Schedule to ${selectedGroupIds.length} Zones`}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 3: MASTER MATRIX GRID (SPREADSHEET) */}
      {/* ========================================================================= */}
      {scheduleMode === 'matrix' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Filter Matrix:</span>
              {[
                { id: 'all', label: `All Zones` },
                { id: 'floor1', label: 'Floor 1' },
                { id: 'floor2', label: 'Floor 2' },
                { id: 'ventilation', label: 'Fresh Air LOSSNAY (4)' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setMatrixFilter(id as any)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition ${
                    matrixFilter === id
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button
                onClick={loadAllMatrixSchedules}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
                title="Reload schedules"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <span>Click any cell to edit schedule</span>
            </div>
          </div>

          {/* Spreadsheet Table */}
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase font-mono">
                <th className="py-3 px-3 min-w-[200px]">HVAC Zone Name</th>
                {DAYS_OF_WEEK.map((d) => (
                  <th key={d.id} className={`py-3 px-2 text-center ${d.highlight ? 'text-blue-400 font-bold' : ''}`}>
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {filteredMatrixGroups.map((g) => {
                const groupPatterns = weeklyPatterns[g.group_id] || {};
                return (
                  <tr key={g.group_id} className="hover:bg-slate-800/40 transition group">
                    <td className="py-3 px-3 font-sans font-bold text-slate-200">
                      <span>{g.name}</span>
                      <span className="block text-[10px] text-slate-500 font-mono">
                        Group {g.group_id} ({g.model}) • Addr {g.address}
                      </span>
                    </td>

                    {DAYS_OF_WEEK.map((d) => {
                      const events = groupPatterns[d.id] || [];
                      const onEvent = events.find((e) => e.drive === 'ON');
                      const offEvent = events.find((e) => e.drive === 'OFF');

                      return (
                        <td key={d.id} className="p-1.5 text-center">
                          <button
                            onClick={() => {
                              setPrimaryGroupId(g.group_id);
                              setSelectedGroupIds([g.group_id]);
                              setSelectedDay(d.id);
                              handleSetMode('planner');
                            }}
                            className={`w-full py-1.5 px-2 rounded-lg font-bold transition border ${
                              events.length > 0 && onEvent
                                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                                : 'bg-slate-950/60 hover:bg-slate-800 text-slate-600 border-slate-800/60'
                            }`}
                            title={`Click to edit ${g.name} on ${d.label}`}
                          >
                            {events.length > 0 && onEvent ? (
                              <span>
                                {String(onEvent.hour).padStart(2, '0')}:{String(onEvent.minute).padStart(2, '0')}
                                {offEvent ? `-${String(offEvent.hour).padStart(2, '0')}:${String(offEvent.minute).padStart(2, '0')}` : ''}
                                {onEvent.set_temp_f ? ` (${onEvent.set_temp_f}°)` : ''}
                              </span>
                            ) : (
                              <span>OFF</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT SCHEDULE EVENT */}
      {/* ========================================================================= */}
      {isEventModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-400" />
                {editingEventIndex !== null ? 'Edit Scheduled Event' : 'Add Scheduled Event'}
              </h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-4">
              {/* Time Selector */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Hour (00 - 23)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={eventForm.hour}
                    onChange={(e) => setEventForm({ ...eventForm, hour: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Minute (00 - 55)</label>
                  <input
                    type="number"
                    min="0"
                    max="55"
                    step="5"
                    value={eventForm.minute}
                    onChange={(e) => setEventForm({ ...eventForm, minute: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
              </div>

              {/* Power Drive */}
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Action / Power State</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, drive: 'ON' })}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      eventForm.drive === 'ON'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Power ON & Condition
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, drive: 'OFF' })}
                    className={`py-2 rounded-xl text-xs font-bold transition border ${
                      eventForm.drive === 'OFF'
                        ? 'bg-rose-600 text-white border-rose-500 shadow'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Power OFF (Shutdown)
                  </button>
                </div>
              </div>

              {eventForm.drive === 'ON' && (
                <>
                  {/* Mode & Setpoint */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">HVAC Mode</label>
                      <select
                        value={eventForm.mode}
                        onChange={(e) => setEventForm({ ...eventForm, mode: e.target.value as OperationMode })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs font-bold"
                      >
                        <option value="AUTO">AUTO (Auto Heat/Cool)</option>
                        <option value="COOL">COOL (Air Conditioning)</option>
                        <option value="HEAT">HEAT (Heating)</option>
                        <option value="FAN">FAN (Air Circulation)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Target Temp ({tempUnit})</label>
                      <input
                        type="number"
                        step="0.5"
                        min={tempUnit === 'F' ? '62' : '19'}
                        max={tempUnit === 'F' ? '86' : '30'}
                        value={tempUnit === 'F' ? eventForm.set_temp_f : eventForm.set_temp_c}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 70;
                          if (tempUnit === 'F') {
                            setEventForm({ ...eventForm, set_temp_f: val, set_temp_c: Math.round(((val - 32) * 5 / 9) * 10) / 10 });
                          } else {
                            setEventForm({ ...eventForm, set_temp_c: val, set_temp_f: Math.round((val * 9 / 5 + 32) * 10) / 10 });
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-300 font-mono font-bold text-sm"
                      />
                    </div>
                  </div>

                  {/* Fan Speed */}
                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">Blower Fan Speed</label>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      {['AUTO', 'LOW', 'MID1', 'HIGH'].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => setEventForm({ ...eventForm, fan_speed: spd as FanSpeed })}
                          className={`py-1.5 rounded-xl font-bold transition border ${
                            eventForm.fan_speed === spd
                              ? 'bg-blue-600 text-white border-blue-500'
                              : 'bg-slate-950 text-slate-400 border-slate-800'
                          }`}
                        >
                          {spd}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900"
                >
                  Save Event to Timeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DUPLICATE DAY */}
      {/* ========================================================================= */}
      {isDuplicateModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <Copy className="w-5 h-5 text-blue-400" />
                Duplicate {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Schedule
              </h3>
              <button
                onClick={() => setIsDuplicateModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Select destination days to copy all events from{' '}
              <strong className="text-blue-400">{DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label}</strong>:
            </p>

            <div className="grid grid-cols-2 gap-2">
              {DAYS_OF_WEEK.filter((d) => d.id !== selectedDay).map((day) => {
                const isChecked = duplicateTargetDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => {
                      setDuplicateTargetDays((prev) =>
                        isChecked ? prev.filter((x) => x !== day.id) : [...prev, day.id]
                      );
                    }}
                    className={`p-3 rounded-2xl font-bold text-xs text-left border flex items-center justify-between transition ${
                      isChecked
                        ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>{day.label}</span>
                    <span className="font-mono text-xs">{isChecked ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsDuplicateModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteDuplicate}
                disabled={duplicateTargetDays.length === 0}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900 disabled:opacity-40"
              >
                Copy to {duplicateTargetDays.length} Days
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
