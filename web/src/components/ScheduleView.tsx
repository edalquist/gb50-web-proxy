import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  Plus, 
  Trash2, 
  Save, 
  Layers, 
  Sun, 
  Sliders,
  Filter
} from 'lucide-react';
import { GroupStatus, ScheduleItem, ScheduleEventInput } from '../types';
import { 
  fetchAllTodaySchedules, 
  fetchWeeklySchedule, 
  updateTodaySchedule, 
  updateWeeklySchedule 
} from '../api';

interface ScheduleViewProps {
  groups: GroupStatus[];
  tempUnit: 'F' | 'C';
}

type ViewMode = 'all_zones' | 'weekly_planner' | 'editor';

const DAYS_OF_WEEK = [
  { id: 7, label: 'Sunday', short: 'Sun', highlight: true },
  { id: 1, label: 'Monday', short: 'Mon' },
  { id: 2, label: 'Tuesday', short: 'Tue' },
  { id: 3, label: 'Wednesday', short: 'Wed' },
  { id: 4, label: 'Thursday', short: 'Thu' },
  { id: 5, label: 'Friday', short: 'Fri' },
  { id: 6, label: 'Saturday', short: 'Sat' },
];

export const ScheduleView: React.FC<ScheduleViewProps> = ({ groups, tempUnit }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('all_zones');
  const [selectedDay, setSelectedDay] = useState<number>(7); // Default Sunday
  const [selectedGroupId, setSelectedGroupId] = useState<number>(1);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([1]);

  // All schedules cache: group_id -> ScheduleItem[]
  const [allSchedules, setAllSchedules] = useState<Record<number, ScheduleItem[]>>({});
  const [weeklyPatterns, setWeeklyPatterns] = useState<Record<number, ScheduleItem[]>>({}); // day -> items
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Filter for Matrix view
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'floor1' | 'floor2' | 'ventilation' | 'scheduled_only'>('all');

  // Event Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  // Load batch today schedules
  const loadAllTodaySchedules = async () => {
    setLoading(true);
    try {
      const data = await fetchAllTodaySchedules();
      setAllSchedules(data);
    } catch (err) {
      console.error('Failed to load all today schedules:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load weekly schedule for selected group
  const loadWeeklySchedule = async (groupId: number) => {
    try {
      const data = await fetchWeeklySchedule(groupId);
      setWeeklyPatterns(data);
    } catch (err) {
      console.error(`Failed to load weekly schedule for group ${groupId}:`, err);
    }
  };

  useEffect(() => {
    loadAllTodaySchedules();
  }, []);

  useEffect(() => {
    if (viewMode === 'weekly_planner' || viewMode === 'editor') {
      loadWeeklySchedule(selectedGroupId);
    }
  }, [selectedGroupId, viewMode]);

  // Current active items to show in editor
  const currentEditorItems: ScheduleItem[] = 
    viewMode === 'weekly_planner' || selectedDay !== 0
      ? weeklyPatterns[selectedDay] || []
      : allSchedules[selectedGroupId] || [];

  // Group selection helpers
  const handleSelectFloor = (floor: 'floor1' | 'floor2' | 'vent' | 'all') => {
    if (floor === 'floor1') {
      setSelectedGroupIds(groups.filter((g) => ((g as { floor?: number }).floor ?? 1) === 1).map((g) => g.group_id));
    } else if (floor === 'floor2') {
      setSelectedGroupIds(groups.filter((g) => ((g as { floor?: number }).floor ?? 1) === 2).map((g) => g.group_id));
    } else if (floor === 'vent') {
      setSelectedGroupIds(groups.filter((g) => g.model === 'LC').map((g) => g.group_id));
    } else {
      setSelectedGroupIds(groups.map((g) => g.group_id));
    }
  };

  const toggleGroupSelection = (gid: number) => {
    if (selectedGroupIds.includes(gid)) {
      if (selectedGroupIds.length > 1) {
        setSelectedGroupIds(selectedGroupIds.filter((id) => id !== gid));
      }
    } else {
      setSelectedGroupIds([...selectedGroupIds, gid]);
    }
  };

  // Modal open helpers
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
    setIsModalOpen(true);
  };

  const handleOpenEditEvent = (item: ScheduleItem) => {
    setEditingEventIndex(item.index);
    setEventForm({
      hour: item.hour,
      minute: item.minute,
      drive: item.drive === 'OFF' ? 'OFF' : 'ON',
      mode: item.mode || 'AUTO',
      set_temp_f: item.set_temp_f ?? (item.set_temp_c ? Math.round((item.set_temp_c * 9) / 5 + 32) : 70),
      set_temp_c: item.set_temp_c ?? 21.1,
      fan_speed: item.fan_speed || 'AUTO',
      air_direction: item.air_direction || 'HORIZONTAL',
    });
    setIsModalOpen(true);
  };

  const handleSaveModalEvent = () => {
    const existing = [...currentEditorItems];
    let updated: ScheduleItem[];

    if (editingEventIndex !== null) {
      // Modify
      updated = existing.map((ev) => {
        if (ev.index === editingEventIndex) {
          const hh = String(eventForm.hour).padStart(2, '0');
          const mm = String(eventForm.minute).padStart(2, '0');
          return {
            ...ev,
            hour: eventForm.hour,
            minute: eventForm.minute,
            drive: eventForm.drive as any,
            mode: eventForm.mode,
            set_temp_f: eventForm.set_temp_f,
            set_temp_c: eventForm.set_temp_c,
            fan_speed: eventForm.fan_speed,
            air_direction: eventForm.air_direction,
            time_str: `${hh}:${mm}`,
          };
        }
        return ev;
      });
    } else {
      // Add
      const nextIdx = existing.length > 0 ? Math.max(...existing.map((e) => e.index)) + 1 : 1;
      const hh = String(eventForm.hour).padStart(2, '0');
      const mm = String(eventForm.minute).padStart(2, '0');
      updated = [
        ...existing,
        {
          index: nextIdx,
          hour: eventForm.hour,
          minute: eventForm.minute,
          drive: eventForm.drive as any,
          mode: eventForm.mode,
          set_temp_f: eventForm.set_temp_f,
          set_temp_c: eventForm.set_temp_c,
          fan_speed: eventForm.fan_speed,
          air_direction: eventForm.air_direction,
          time_str: `${hh}:${mm}`,
        },
      ];
    }

    // Sort chronologically
    updated.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    // Re-index 1..N
    updated = updated.map((e, idx) => ({ ...e, index: idx + 1 }));

    if (viewMode === 'weekly_planner' || selectedDay !== 0) {
      setWeeklyPatterns({ ...weeklyPatterns, [selectedDay]: updated });
    } else {
      setAllSchedules({ ...allSchedules, [selectedGroupId]: updated });
    }

    setIsModalOpen(false);
  };

  const handleDeleteEvent = (index: number) => {
    const existing = [...currentEditorItems];
    let updated = existing.filter((e) => e.index !== index);
    updated = updated.map((e, idx) => ({ ...e, index: idx + 1 }));

    if (viewMode === 'weekly_planner' || selectedDay !== 0) {
      setWeeklyPatterns({ ...weeklyPatterns, [selectedDay]: updated });
    } else {
      setAllSchedules({ ...allSchedules, [selectedGroupId]: updated });
    }
  };

  const handleClearSchedule = () => {
    if (confirm('Clear all scheduled timer events for the selected day/zones?')) {
      if (viewMode === 'weekly_planner' || selectedDay !== 0) {
        setWeeklyPatterns({ ...weeklyPatterns, [selectedDay]: [] });
      } else {
        setAllSchedules({ ...allSchedules, [selectedGroupId]: [] });
      }
    }
  };

  // Commit changes to GB-50 controller
  const handleSaveToController = async () => {
    setIsSaving(true);
    setSaveStatus(null);

    const itemsToSend = currentEditorItems.map((e) => ({
      hour: e.hour,
      minute: e.minute,
      drive: (e.drive === 'OFF' ? 'OFF' : 'ON') as 'ON' | 'OFF',
      mode: e.mode,
      set_temp_c: e.set_temp_c,
      set_temp_f: e.set_temp_f,
      fan_speed: e.fan_speed,
      air_direction: e.air_direction,
    }));

    try {
      if (viewMode === 'weekly_planner' || selectedDay !== 0) {
        const res = await updateWeeklySchedule(selectedGroupIds, selectedDay, itemsToSend);
        setSaveStatus(res.message);
        await loadWeeklySchedule(selectedGroupId);
      } else {
        const res = await updateTodaySchedule(selectedGroupIds, itemsToSend);
        setSaveStatus(res.message);
        await loadAllTodaySchedules();
      }
    } catch (err: any) {
      setSaveStatus(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Filter groups for matrix view
  const filteredGroups = groups.filter((g) => {
    if (timelineFilter === 'floor1') return ((g as { floor?: number }).floor ?? 1) === 1;
    if (timelineFilter === 'floor2') return ((g as { floor?: number }).floor ?? 1) === 2;
    if (timelineFilter === 'ventilation') return g.model === 'LC';
    if (timelineFilter === 'scheduled_only') return (allSchedules[g.group_id] || []).length > 0;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Header & View Mode Switcher */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            Church HVAC Automated Schedules & Timers
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            View master church timelines, configure weekly automation patterns, and batch program entire church floors.
          </p>
        </div>

        {/* View Switcher Pills */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setViewMode('all_zones')}
            className={`px-3 py-1.5 rounded-lg transition ${
              viewMode === 'all_zones' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Church Timeline Matrix
          </button>
          <button
            onClick={() => setViewMode('weekly_planner')}
            className={`px-3 py-1.5 rounded-lg transition ${
              viewMode === 'weekly_planner' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Weekly 7-Day Planner
          </button>
          <button
            onClick={() => setViewMode('editor')}
            className={`px-3 py-1.5 rounded-lg transition ${
              viewMode === 'editor' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Multi-Zone Batch Editor
          </button>
        </div>
      </div>

      {/* VIEW 1: Master Church 24-Hour Timeline Matrix */}
      {viewMode === 'all_zones' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100">All Zones Today Schedule Matrix</h3>
              <p className="text-xs text-slate-400">
                Visual 24-hour breakdown of programmed startups, setbacks, and shutdowns across the facility.
              </p>
            </div>

            {/* Matrix Filters */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filter:
              </span>
              {[
                { id: 'all', label: 'All Units' },
                { id: 'floor1', label: 'Floor 1' },
                { id: 'floor2', label: 'Floor 2' },
                { id: 'ventilation', label: 'LOSSNAY' },
                { id: 'scheduled_only', label: 'Scheduled Only' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setTimelineFilter(id as any)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition ${
                    timelineFilter === id
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-xs text-slate-400">Loading full church timeline...</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[850px] space-y-2">
                {/* 24h Axis Ruler */}
                <div className="grid grid-cols-25 text-[10px] font-mono text-slate-500 font-bold border-b border-slate-800 pb-2">
                  <div className="col-span-3 text-left">Zone Name</div>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="text-center">
                      {h % 3 === 0 ? `${h}h` : '•'}
                    </div>
                  ))}
                </div>

                {/* Zone Rows */}
                {filteredGroups.map((g) => {
                  const events = allSchedules[g.group_id] || [];
                  return (
                    <div
                      key={g.group_id}
                      onClick={() => {
                        setSelectedGroupId(g.group_id);
                        setSelectedGroupIds([g.group_id]);
                        setViewMode('editor');
                      }}
                      className="grid grid-cols-25 items-center p-2 rounded-xl bg-slate-950/60 hover:bg-slate-800/60 cursor-pointer transition border border-transparent hover:border-slate-700"
                    >
                      <div className="col-span-3 flex items-center gap-2 pr-2">
                        <span className="font-mono text-[11px] font-bold text-blue-400">Gr.{g.group_id}</span>
                        <span className="text-xs font-bold text-slate-200 truncate">{g.name}</span>
                      </div>

                      {/* 24-hour visual track */}
                      <div className="col-span-22 relative h-7 bg-slate-900/90 rounded-lg border border-slate-800/80 overflow-hidden flex items-center">
                        {events.length > 0 ? (
                          events.map((ev) => {
                            const leftPct = ((ev.hour + ev.minute / 60) / 24) * 100;
                            const isTurnOn = ev.drive === 'ON';
                            const temp = tempUnit === 'F' ? ev.set_temp_f : ev.set_temp_c;
                            return (
                              <div
                                key={ev.index}
                                style={{ left: `${Math.max(0, Math.min(94, leftPct))}%` }}
                                className={`absolute top-1 bottom-1 px-1.5 rounded text-[10px] font-extrabold flex items-center gap-1 shadow-sm whitespace-nowrap z-10 ${
                                  isTurnOn
                                    ? 'bg-emerald-600 text-white border border-emerald-400'
                                    : 'bg-rose-900/80 text-rose-200 border border-rose-700'
                                }`}
                                title={`${ev.time_str} - ${ev.drive} ${ev.mode || ''} ${temp ? `${temp}°${tempUnit}` : ''}`}
                              >
                                <span>{ev.time_str}</span>
                                {temp && <span>{temp}°</span>}
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-[10px] text-slate-600 px-3 italic">No schedule events today</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Weekly 7-Day Schedule Planner */}
      {viewMode === 'weekly_planner' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-400" />
                Weekly Timetable Pattern
              </h3>
              <p className="text-xs text-slate-400">
                Inspect and program automated recurring weekly schedules from Sunday through Saturday.
              </p>
            </div>

            {/* Zone Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-400">Target Zone:</label>
              <select
                value={selectedGroupId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedGroupId(id);
                  setSelectedGroupIds([id]);
                }}
                className="bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-1.5 font-bold"
              >
                {groups.map((g) => (
                  <option key={g.group_id} value={g.group_id}>
                    Gr.{g.group_id} - {g.name} ({g.model})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 7-Day Day Selector Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {DAYS_OF_WEEK.map((day) => {
              const dayEvents = weeklyPatterns[day.id] || [];
              const isSelected = selectedDay === day.id;
              return (
                <button
                  key={day.id}
                  onClick={() => setSelectedDay(day.id)}
                  className={`p-3 rounded-xl border text-left transition ${
                    isSelected
                      ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-900/50'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{day.label}</span>
                    {day.highlight && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
                        Service
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-2 opacity-80">
                    {dayEvents.length > 0 ? `${dayEvents.length} Events Set` : 'Off / Unset'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Day Timeline List */}
          <div className="bg-slate-950/80 rounded-2xl border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-sm text-slate-200">
                  {DAYS_OF_WEEK.find((d) => d.id === selectedDay)?.label} Schedule for Group {selectedGroupId}
                </h4>
                <span className="text-xs text-slate-400">{currentEditorItems.length} Programmed Events</span>
              </div>

              <button
                onClick={handleOpenAddEvent}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-blue-900/40"
              >
                <Plus className="w-4 h-4" /> Add Event
              </button>
            </div>

            {currentEditorItems.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {currentEditorItems.map((event) => {
                  const isTurnOn = event.drive === 'ON';
                  const temp = tempUnit === 'F' ? event.set_temp_f : event.set_temp_c;
                  return (
                    <div
                      key={event.index}
                      className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold font-mono text-slate-100">{event.time_str}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isTurnOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {event.drive || 'ON'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Mode: {event.mode || 'AUTO'} • Fan: {event.fan_speed || 'AUTO'}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        {temp && (
                          <span className="text-base font-bold text-blue-400 font-mono">
                            {temp}°{tempUnit}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenEditEvent(event)}
                            className="p-1.5 text-slate-400 hover:text-white rounded bg-slate-800"
                            title="Edit Event"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(event.index)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 rounded bg-slate-800"
                            title="Delete Event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-slate-500">
                No events programmed for {DAYS_OF_WEEK.find((d) => d.id === selectedDay)?.label}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: Multi-Zone Batch Schedule Studio & Editor */}
      {viewMode === 'editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Zone & Floor Batch Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              1. Select Target Zones
            </h3>
            <p className="text-xs text-slate-400">
              Apply this schedule to a single unit or batch program entire church floors simultaneously.
            </p>

            {/* Quick Floor Selectors */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSelectFloor('floor1')}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500 text-xs font-bold text-slate-300 transition"
              >
                Floor 1
              </button>
              <button
                onClick={() => handleSelectFloor('floor2')}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500 text-xs font-bold text-slate-300 transition"
              >
                Floor 2
              </button>
              <button
                onClick={() => handleSelectFloor('vent')}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-teal-500 text-xs font-bold text-teal-300 transition"
              >
                Ventilation (4 HRUs)
              </button>
              <button
                onClick={() => handleSelectFloor('all')}
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition shadow-sm"
              >
                All Zones
              </button>
            </div>

            {/* Group Checklist */}
            <div className="max-h-[360px] overflow-y-auto space-y-1 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950/60">
              {groups.map((g) => {
                const isChecked = selectedGroupIds.includes(g.group_id);
                return (
                  <div
                    key={g.group_id}
                    onClick={() => toggleGroupSelection(g.group_id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition ${
                      isChecked
                        ? 'bg-blue-600/20 text-blue-300 font-bold border border-blue-500/30'
                        : 'text-slate-400 hover:bg-slate-900'
                    }`}
                  >
                    <span>
                      Gr.{g.group_id} - {g.name}
                    </span>
                    <span className="text-[10px] font-mono opacity-60">{g.model}</span>
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-slate-400 font-semibold">
              Selected: <strong className="text-blue-400">{selectedGroupIds.length} Zones</strong>
            </div>
          </div>

          {/* Right 2 Columns: Event Timeline Editor */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-sm text-slate-100">2. Program Timeline Events</h3>
                <p className="text-xs text-slate-400">
                  Target Day:{' '}
                  <strong className="text-blue-400">
                    {DAYS_OF_WEEK.find((d) => d.id === selectedDay)?.label || 'Today'}
                  </strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearSchedule}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 text-xs font-semibold rounded-xl transition"
                >
                  Clear Events
                </button>
                <button
                  onClick={handleOpenAddEvent}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-blue-900/40"
                >
                  <Plus className="w-4 h-4" /> Add Event
                </button>
              </div>
            </div>

            {/* Events List */}
            <div className="space-y-3">
              {currentEditorItems.length > 0 ? (
                currentEditorItems.map((event) => {
                  const isTurnOn = event.drive === 'ON';
                  const temp = tempUnit === 'F' ? event.set_temp_f : event.set_temp_c;
                  return (
                    <div
                      key={event.index}
                      className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-xl font-bold font-mono text-slate-100">{event.time_str}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-bold ${
                                isTurnOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {event.drive || 'ON'}
                            </span>
                            {event.mode && (
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                {event.mode}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Fan Speed: {event.fan_speed || 'AUTO'} • Louvers: {event.air_direction || 'AUTO'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {temp && (
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Set Temp</span>
                            <span className="text-lg font-bold text-blue-400 font-mono">
                              {temp}°{tempUnit}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditEvent(event)}
                            className="p-2 text-slate-400 hover:text-white rounded-lg bg-slate-900 border border-slate-800"
                            title="Edit Event"
                          >
                            <Sliders className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(event.index)}
                            className="p-2 text-slate-400 hover:text-rose-400 rounded-lg bg-slate-900 border border-slate-800"
                            title="Delete Event"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 bg-slate-950/40 rounded-xl border border-slate-800">
                  <Clock className="w-6 h-6 text-slate-500 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">No scheduled events in this pattern.</p>
                  <button
                    onClick={handleOpenAddEvent}
                    className="mt-3 px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg"
                  >
                    Add First Event
                  </button>
                </div>
              )}
            </div>

            {/* Save Action Bar */}
            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              {saveStatus ? (
                <div className="text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-xl">
                  {saveStatus}
                </div>
              ) : <div />}

              <button
                onClick={handleSaveToController}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900 transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving to Controller...' : `Apply & Save to ${selectedGroupIds.length} Zone(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Add / Edit Event Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-100">
                {editingEventIndex !== null ? `Edit Event #${editingEventIndex}` : 'Add Scheduled Event'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Time Pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Hour (0..23):</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={eventForm.hour}
                    onChange={(e) => setEventForm({ ...eventForm, hour: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Minute (0..59):</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={eventForm.minute}
                    onChange={(e) => setEventForm({ ...eventForm, minute: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              {/* Power Drive */}
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Power Command:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, drive: 'ON' })}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      eventForm.drive === 'ON'
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Power ON
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, drive: 'OFF' })}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      eventForm.drive === 'OFF'
                        ? 'bg-rose-600 text-white border-rose-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Power OFF
                  </button>
                </div>
              </div>

              {/* Mode & Temperature (only if ON) */}
              {eventForm.drive === 'ON' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Mode:</label>
                      <select
                        value={eventForm.mode}
                        onChange={(e) => setEventForm({ ...eventForm, mode: e.target.value as any })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value="AUTO">Auto</option>
                        <option value="HEAT">Heat</option>
                        <option value="COOL">Cool</option>
                        <option value="FAN">Fan</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">
                        Target Temp (°{tempUnit}):
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        value={tempUnit === 'F' ? eventForm.set_temp_f : eventForm.set_temp_c}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 70;
                          if (tempUnit === 'F') {
                            setEventForm({
                              ...eventForm,
                              set_temp_f: val,
                              set_temp_c: roundC((val - 32) * (5 / 9)),
                            });
                          } else {
                            setEventForm({
                              ...eventForm,
                              set_temp_c: val,
                              set_temp_f: Math.round((val * 9) / 5 + 32),
                            });
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Fan Speed:</label>
                      <select
                        value={eventForm.fan_speed}
                        onChange={(e) => setEventForm({ ...eventForm, fan_speed: e.target.value as any })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value="AUTO">Auto</option>
                        <option value="LOW">Low</option>
                        <option value="MID1">Medium</option>
                        <option value="HIGH">High</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Louver Vane:</label>
                      <select
                        value={eventForm.air_direction}
                        onChange={(e) => setEventForm({ ...eventForm, air_direction: e.target.value as any })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value="HORIZONTAL">Horizontal</option>
                        <option value="VERTICAL">Vertical</option>
                        <option value="SWING">Swing</option>
                        <option value="AUTO">Auto</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveModalEvent}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-blue-900"
              >
                {editingEventIndex !== null ? 'Save Event Changes' : 'Add to Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function roundC(val: number): number {
  return Math.round(val * 10) / 10;
}
