import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, 
  Clock, 
  Layers, 
  Plus, 
  Trash2, 
  Save, 
  Copy, 
  CheckCircle2, 
  RefreshCw, 
  Edit2, 
  X, 
  AlertTriangle, 
  ArrowRight, 
  Search, 
  Send
} from 'lucide-react';
import { 
  GroupStatus, 
  ScheduleItem, 
  ScheduleProgram, 
  ScheduleEventInput, 
  OperationMode 
} from '../types';
import { 
  fetchWeeklySchedule, 
  updateWeeklySchedule,
  fetchSchedulePrograms,
  createScheduleProgram,
  updateScheduleProgram,
  deleteScheduleProgram,
  assignZonesToProgram,
  pushScheduleProgramToHardware,
  reconstructSchedulesFromHardware,
  fetchAllZoneAssignments,
  updateZonePrograms,
  fetchZoneMergedSchedule
} from '../api';
import { useAuth } from '../AuthContext';

interface ScheduleViewProps {
  groups: GroupStatus[];
  tempUnit: 'F' | 'C';
  activeMode?: ScheduleMode;
  onModeChange?: (mode: ScheduleMode) => void;
}

export type ScheduleMode = 'programs' | 'planner' | 'matrix';

const DAYS_OF_WEEK = [
  { id: 7, label: 'Sunday', short: 'Sun', highlight: true },
  { id: 1, label: 'Monday', short: 'Mon' },
  { id: 2, label: 'Tuesday', short: 'Tue' },
  { id: 3, label: 'Wednesday', short: 'Wed', highlight: true },
  { id: 4, label: 'Thursday', short: 'Thu' },
  { id: 5, label: 'Friday', short: 'Fri' },
  { id: 6, label: 'Saturday', short: 'Sat' },
];

const COLOR_CLASSES: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', badge: 'bg-blue-500 text-white' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', badge: 'bg-emerald-500 text-white' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', badge: 'bg-purple-500 text-white' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', badge: 'bg-amber-500 text-white' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30', badge: 'bg-rose-500 text-white' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', badge: 'bg-cyan-500 text-white' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30', badge: 'bg-indigo-500 text-white' },
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30', badge: 'bg-slate-600 text-slate-200' },
};

interface TimelineSpan {
  startMin: number;
  endMin: number;
  startStr: string;
  endStr: string;
  drive: 'ON' | 'OFF';
  mode?: OperationMode;
  tempF?: number;
  tempC?: number;
  fanSpeed?: string;
  airDirection?: string;
  eventIndex?: number;
  sourceProgramName?: string;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  groups,
  tempUnit,
  activeMode,
  onModeChange,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'operator';

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(activeMode || 'programs');

  useEffect(() => {
    if (activeMode && activeMode !== scheduleMode) {
      setScheduleMode(activeMode);
    }
  }, [activeMode]);

  const handleSetMode = (mode: ScheduleMode) => {
    setScheduleMode(mode);
    onModeChange?.(mode);
  };

  // --- Schedule Programs State ---
  const [programs, setPrograms] = useState<ScheduleProgram[]>([]);
  const [zoneAssignments, setZoneAssignments] = useState<Record<number, number[]>>({});
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Modals for Programs
  const [selectedProgramForAssign, setSelectedProgramForAssign] = useState<ScheduleProgram | null>(null);
  const [assignModalSelectedZones, setAssignModalSelectedZones] = useState<number[]>([]);
  const [assignFilterFloor, setAssignFilterFloor] = useState<'all' | 'floor1' | 'floor2' | 'lossnay'>('all');

  const [editingProgram, setEditingProgram] = useState<ScheduleProgram | null>(null);
  const [isCreateProgramOpen, setIsCreateProgramOpen] = useState(false);
  const [programFormName, setProgramFormName] = useState('');
  const [programFormDesc, setProgramFormDesc] = useState('');
  const [programFormColor, setProgramFormColor] = useState('blue');
  const [programFormPattern, setProgramFormPattern] = useState<Record<number, any[]>>({
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: []
  });
  const [programEditorDay, setProgramEditorDay] = useState<number>(7);

  // Layer Management Modal (Planner)
  const [isLayerModalOpen, setIsLayerModalOpen] = useState(false);
  const [layerModalSelectedPrograms, setLayerModalSelectedPrograms] = useState<number[]>([]);

  // --- Planner State ---
  const [selectedDay, setSelectedDay] = useState<number>(7); // Default Sunday
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(() =>
    groups.length > 0 ? [groups[0].group_id] : [1]
  );
  const [primaryGroupId, setPrimaryGroupId] = useState<number>(() =>
    groups.length > 0 ? groups[0].group_id : 1
  );
  const [weeklyPatterns, setWeeklyPatterns] = useState<Record<number, Record<number, ScheduleItem[]>>>({});
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [plannerSearch, setPlannerSearch] = useState('');

  // Synchronize primaryGroupId when groups finish initial load
  useEffect(() => {
    if (groups.length > 0) {
      if (!groups.some((g) => g.group_id === primaryGroupId)) {
        setPrimaryGroupId(groups[0].group_id);
        setSelectedGroupIds([groups[0].group_id]);
      }
    }
  }, [groups]);

  // Event Edit Modal
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [eventFormTarget, setEventFormTarget] = useState<'planner' | 'programEditor'>('planner');
  const [eventForm, setEventForm] = useState<ScheduleEventInput>({
    hour: 8,
    minute: 0,
    drive: 'ON',
    mode: 'AUTO',
    set_temp_f: 71.0,
    set_temp_c: 21.5,
    fan_speed: 'AUTO',
    air_direction: 'HORIZONTAL',
  });

  // Day Duplicate Modal
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateTargetDays, setDuplicateTargetDays] = useState<number[]>([]);

  // Matrix Filter
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'floor1' | 'floor2' | 'ventilation'>('all');
  const [matrixSearch, setMatrixSearch] = useState('');

  // --- Data Loading ---
  const loadPrograms = async () => {
    setLoadingPrograms(true);
    try {
      const [progs, assigns] = await Promise.all([
        fetchSchedulePrograms(),
        fetchAllZoneAssignments().catch(() => ({})),
      ]);
      setPrograms(progs);
      setZoneAssignments(assigns);
    } catch (err: any) {
      console.error('Failed to load schedule programs:', err);
    } finally {
      setLoadingPrograms(false);
    }
  };

  useEffect(() => {
    loadPrograms();
  }, []);

  const loadWeeklyScheduleForGroup = async (groupId: number) => {
    if (!groupId) return;
    setLoadingSchedule(true);
    try {
      const assignedPids = zoneAssignments[groupId] || [];
      if (assignedPids.length > 0) {
        const mergedData = await fetchZoneMergedSchedule(groupId);
        setWeeklyPatterns((prev) => ({
          ...prev,
          [groupId]: mergedData.merged_pattern,
        }));
      } else {
        const data = await fetchWeeklySchedule(groupId);
        setWeeklyPatterns((prev) => ({
          ...prev,
          [groupId]: data,
        }));
      }
    } catch (err) {
      console.error(`Failed to load weekly schedule for group ${groupId}:`, err);
      // Fallback to direct controller query
      try {
        const fallback = await fetchWeeklySchedule(groupId);
        setWeeklyPatterns((prev) => ({ ...prev, [groupId]: fallback }));
      } catch (_) {}
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => {
    if (primaryGroupId) {
      loadWeeklyScheduleForGroup(primaryGroupId);
    }
  }, [primaryGroupId, zoneAssignments]);

  const loadAllMatrixSchedules = async () => {
    for (const g of groups) {
      if (!weeklyPatterns[g.group_id]) {
        await loadWeeklyScheduleForGroup(g.group_id);
      }
    }
  };

  useEffect(() => {
    if (scheduleMode === 'matrix') {
      loadAllMatrixSchedules();
    }
  }, [scheduleMode]);

  // Current day events for planner
  const currentDayEvents: ScheduleItem[] = useMemo(() => {
    const groupSched = weeklyPatterns[primaryGroupId];
    if (!groupSched) return [];
    return groupSched[selectedDay] || groupSched[String(selectedDay) as any] || [];
  }, [weeklyPatterns, primaryGroupId, selectedDay]);

  // Group lookup map
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.group_id, g])), [groups]);

  // Programs lookup map
  const programMap = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);

  // Assigned programs for current primary group
  const currentAssignedPrograms: ScheduleProgram[] = useMemo(() => {
    const assignedIds = zoneAssignments[primaryGroupId] || [];
    return assignedIds
      .map((id) => programMap.get(id))
      .filter((p): p is ScheduleProgram => p !== undefined);
  }, [zoneAssignments, primaryGroupId, programMap]);

  // Calculate 24-hour visual timeline spans for current day
  const timelineSpans: TimelineSpan[] = useMemo(() => {
    if (!currentDayEvents || currentDayEvents.length === 0) {
      return [{
        startMin: 0,
        endMin: 1440,
        startStr: '00:00',
        endStr: '24:00',
        drive: 'OFF',
      }];
    }

    const sorted = [...currentDayEvents].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    const spans: TimelineSpan[] = [];

    // If first event is after 00:00, add leading OFF span
    const firstMin = sorted[0].hour * 60 + sorted[0].minute;
    if (firstMin > 0) {
      spans.push({
        startMin: 0,
        endMin: firstMin,
        startStr: '00:00',
        endStr: sorted[0].time_str || `${String(sorted[0].hour).padStart(2, '0')}:${String(sorted[0].minute).padStart(2, '0')}`,
        drive: 'OFF',
      });
    }

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const startMin = ev.hour * 60 + ev.minute;
      const nextMin = (i < sorted.length - 1) ? (sorted[i + 1].hour * 60 + sorted[i + 1].minute) : 1440;
      
      const startStr = ev.time_str || `${String(ev.hour).padStart(2, '0')}:${String(ev.minute).padStart(2, '0')}`;
      const endStr = (i < sorted.length - 1)
        ? (sorted[i + 1].time_str || `${String(sorted[i + 1].hour).padStart(2, '0')}:${String(sorted[i + 1].minute).padStart(2, '0')}`)
        : '24:00';

      const isOff = ev.drive === 'OFF';
      spans.push({
        startMin,
        endMin: nextMin,
        startStr,
        endStr,
        drive: isOff ? 'OFF' : 'ON',
        mode: ev.mode,
        tempF: ev.set_temp_f || (ev.set_temp_c ? Math.round((ev.set_temp_c * 9/5) + 32) : 71),
        tempC: ev.set_temp_c,
        fanSpeed: ev.fan_speed,
        airDirection: ev.air_direction,
        eventIndex: i,
        sourceProgramName: ev.source_program_name,
      });
    }

    return spans;
  }, [currentDayEvents]);

  // --- Layer Management Action Handlers ---
  const handleOpenLayerModal = () => {
    const currentPids = zoneAssignments[primaryGroupId] || [];
    setLayerModalSelectedPrograms([...currentPids]);
    setIsLayerModalOpen(true);
  };

  const handleSaveLayerAssignments = async () => {
    setIsSaving(true);
    setStatusMsg(null);
    try {
      for (const gid of selectedGroupIds) {
        const res = await updateZonePrograms(gid, layerModalSelectedPrograms);
        setWeeklyPatterns((prev) => ({
          ...prev,
          [gid]: res.merged_pattern,
        }));
      }

      setZoneAssignments((prev) => {
        const next = { ...prev };
        for (const gid of selectedGroupIds) {
          next[gid] = [...layerModalSelectedPrograms];
        }
        return next;
      });

      await loadPrograms();
      setIsLayerModalOpen(false);
      setStatusMsg(`Updated schedule layers for ${selectedGroupIds.length} zone(s) and synced to controller.`);
    } catch (err: any) {
      setStatusMsg(`Error updating schedule layers: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Program Action Handlers ---
  const handleOpenAssignModal = (prog: ScheduleProgram) => {
    setSelectedProgramForAssign(prog);
    setAssignModalSelectedZones([...prog.assigned_group_ids]);
  };

  const handleSaveAssignments = async () => {
    if (!selectedProgramForAssign) return;
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const updated = await assignZonesToProgram(selectedProgramForAssign.id, assignModalSelectedZones);
      setPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSelectedProgramForAssign(null);
      setStatusMsg(`Successfully assigned ${assignModalSelectedZones.length} zones to '${updated.name}' and synced to controller.`);
      for (const gid of assignModalSelectedZones) {
        loadWeeklyScheduleForGroup(gid);
      }
      await loadPrograms();
    } catch (err: any) {
      setStatusMsg(`Error assigning zones: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePushProgramToHardware = async (prog: ScheduleProgram) => {
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const res = await pushScheduleProgramToHardware(prog.id);
      setStatusMsg(res.message || `Successfully synced '${prog.name}' to controller.`);
      loadPrograms();
    } catch (err: any) {
      setStatusMsg(`Error syncing schedule: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReconstructHardware = async () => {
    if (!confirm("This will scan all 50 zones on the GB-50 controller, cluster identical weekly patterns, and refresh schedule programs. Continue?")) return;
    setLoadingPrograms(true);
    setStatusMsg(null);
    try {
      const refreshed = await reconstructSchedulesFromHardware();
      setPrograms(refreshed);
      await loadPrograms();
      setStatusMsg(`Successfully reconstructed ${refreshed.length} schedule programs from controller hardware.`);
    } catch (err: any) {
      setStatusMsg(`Error reconstructing schedules: ${err.message}`);
    } finally {
      setLoadingPrograms(false);
    }
  };

  const handleDeleteProgram = async (progId: number) => {
    if (!confirm("Are you sure you want to delete this schedule program? Assigned zones will remain on their current hardware schedule.")) return;
    try {
      await deleteScheduleProgram(progId);
      setPrograms((prev) => prev.filter((p) => p.id !== progId));
      await loadPrograms();
      setStatusMsg("Schedule program deleted.");
    } catch (err: any) {
      setStatusMsg(`Error deleting program: ${err.message}`);
    }
  };

  const handleOpenEditProgram = (prog: ScheduleProgram) => {
    setEditingProgram(prog);
    setProgramFormName(prog.name);
    setProgramFormDesc(prog.description);
    setProgramFormColor(prog.color || 'blue');
    setProgramFormPattern(JSON.parse(JSON.stringify(prog.weekly_pattern)));
    setProgramEditorDay(7);
    setIsCreateProgramOpen(true);
  };

  const handleOpenCreateProgram = () => {
    setEditingProgram(null);
    setProgramFormName('');
    setProgramFormDesc('');
    setProgramFormColor('blue');
    setProgramFormPattern({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] });
    setProgramEditorDay(7);
    setIsCreateProgramOpen(true);
  };

  const handleSaveProgramForm = async () => {
    if (!programFormName.trim()) {
      alert("Please enter a program name");
      return;
    }
    setIsSaving(true);
    setStatusMsg(null);
    try {
      if (editingProgram) {
        const updated = await updateScheduleProgram(editingProgram.id, {
          name: programFormName.trim(),
          description: programFormDesc.trim(),
          color: programFormColor,
          weekly_pattern: programFormPattern,
        });
        setPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setStatusMsg(`Updated schedule program '${updated.name}' and written to controller.`);
      } else {
        const created = await createScheduleProgram({
          name: programFormName.trim(),
          description: programFormDesc.trim(),
          color: programFormColor,
          weekly_pattern: programFormPattern,
          assigned_group_ids: [],
        });
        setPrograms((prev) => [...prev, created]);
        setStatusMsg(`Created new schedule program '${created.name}'.`);
      }
      await loadPrograms();
      setIsCreateProgramOpen(false);
    } catch (err: any) {
      setStatusMsg(`Error saving program: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Planner Action Handlers ---
  const handleLoadProgramIntoPlanner = (prog: ScheduleProgram) => {
    setWeeklyPatterns((prev) => ({
      ...prev,
      [primaryGroupId]: JSON.parse(JSON.stringify(prog.weekly_pattern)),
    }));
    setStatusMsg(`Loaded schedule pattern from program '${prog.name}'. Click 'Save Schedule to Controller' to flash.`);
  };

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

      setStatusMsg(res.message || `Saved ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} schedule to ${selectedGroupIds.length} zones.`);
      loadPrograms();
    } catch (err: any) {
      setStatusMsg(`Error saving to controller: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenEventModal = (target: 'planner' | 'programEditor', index: number | null = null) => {
    setEventFormTarget(target);
    setEditingEventIndex(index);
    if (index !== null) {
      const ev = target === 'planner' ? currentDayEvents[index] : (programFormPattern[programEditorDay] || [])[index];
      if (ev) {
        setEventForm({
          hour: ev.hour,
          minute: ev.minute,
          drive: ev.drive || 'ON',
          mode: ev.mode || 'AUTO',
          set_temp_f: ev.set_temp_f || (ev.set_temp_c ? Math.round((ev.set_temp_c * 9/5) + 32) : 71),
          set_temp_c: ev.set_temp_c || 21.5,
          fan_speed: ev.fan_speed || 'AUTO',
          air_direction: ev.air_direction || 'HORIZONTAL',
        });
      }
    } else {
      setEventForm({
        hour: 8,
        minute: 0,
        drive: 'ON',
        mode: 'AUTO',
        set_temp_f: 71.0,
        set_temp_c: 21.5,
        fan_speed: 'AUTO',
        air_direction: 'HORIZONTAL',
      });
    }
    setIsEventModalOpen(true);
  };

  const handleSaveEvent = () => {
    const timeStr = `${String(eventForm.hour).padStart(2, '0')}:${String(eventForm.minute).padStart(2, '0')}`;
    const newEvent: any = {
      index: editingEventIndex !== null ? editingEventIndex + 1 : 1,
      hour: eventForm.hour,
      minute: eventForm.minute,
      time_str: timeStr,
      drive: eventForm.drive,
      mode: eventForm.mode,
      set_temp_c: eventForm.set_temp_c,
      set_temp_f: eventForm.set_temp_f,
      fan_speed: eventForm.fan_speed,
      air_direction: eventForm.air_direction,
    };

    if (eventFormTarget === 'planner') {
      let updated = [...currentDayEvents];
      if (editingEventIndex !== null) {
        updated[editingEventIndex] = newEvent;
      } else {
        if (updated.length >= 16) {
          alert("Maximum 16 timer events allowed per day on GB-50 controller.");
          return;
        }
        updated.push(newEvent);
      }
      updated.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
      updated.forEach((e, idx) => { e.index = idx + 1; });

      setWeeklyPatterns((prev) => ({
        ...prev,
        [primaryGroupId]: {
          ...(prev[primaryGroupId] || {}),
          [selectedDay]: updated,
        },
      }));
    } else {
      let dayList = [...(programFormPattern[programEditorDay] || [])];
      if (editingEventIndex !== null) {
        dayList[editingEventIndex] = newEvent;
      } else {
        if (dayList.length >= 16) {
          alert("Maximum 16 timer events allowed per day on GB-50 controller.");
          return;
        }
        dayList.push(newEvent);
      }
      dayList.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
      dayList.forEach((e, idx) => { e.index = idx + 1; });

      setProgramFormPattern((prev) => ({
        ...prev,
        [programEditorDay]: dayList,
      }));
    }

    setIsEventModalOpen(false);
  };

  const handleDeleteEvent = (target: 'planner' | 'programEditor', index: number) => {
    if (target === 'planner') {
      const updated = currentDayEvents.filter((_, idx) => idx !== index);
      updated.forEach((e, idx) => { e.index = idx + 1; });
      setWeeklyPatterns((prev) => ({
        ...prev,
        [primaryGroupId]: {
          ...(prev[primaryGroupId] || {}),
          [selectedDay]: updated,
        },
      }));
    } else {
      const updated = (programFormPattern[programEditorDay] || []).filter((_, idx) => idx !== index);
      updated.forEach((e, idx) => { e.index = idx + 1; });
      setProgramFormPattern((prev) => ({
        ...prev,
        [programEditorDay]: updated,
      }));
    }
  };

  const handleDuplicateDay = () => {
    if (duplicateTargetDays.length === 0) return;
    setWeeklyPatterns((prev) => {
      const next = { ...prev };
      const currentG = next[primaryGroupId] || {};
      duplicateTargetDays.forEach((targetDay) => {
        currentG[targetDay] = currentDayEvents.map((ev) => ({ ...ev }));
      });
      next[primaryGroupId] = currentG;
      return next;
    });
    setIsDuplicateModalOpen(false);
    setStatusMsg(`Copied ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} schedule to ${duplicateTargetDays.length} day(s). Click 'Save Schedule to Controller' to flash.`);
  };

  // Helper zone filters
  const applyZoneFilter = (preset: 'floor1' | 'floor2' | 'lossnay' | 'all' | 'clear') => {
    if (preset === 'floor1') {
      const f1 = groups.filter((g) => g.floor === 1 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 1)).map((g) => g.group_id);
      setSelectedGroupIds(f1);
      if (f1.length) setPrimaryGroupId(f1[0]);
    } else if (preset === 'floor2') {
      const f2 = groups.filter((g) => g.floor === 2 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 2)).map((g) => g.group_id);
      setSelectedGroupIds(f2);
      if (f2.length) setPrimaryGroupId(f2[0]);
    } else if (preset === 'lossnay') {
      const loss = groups.filter((g) => g.model === 'LC').map((g) => g.group_id);
      setSelectedGroupIds(loss);
      if (loss.length) setPrimaryGroupId(loss[0]);
    } else if (preset === 'all') {
      const all = groups.map((g) => g.group_id);
      setSelectedGroupIds(all);
      if (all.length) setPrimaryGroupId(all[0]);
    } else if (preset === 'clear') {
      setSelectedGroupIds([]);
    }
  };

  // Filtered Zones for Planner
  const filteredPlannerGroups = groups.filter((g) => {
    if (plannerSearch) {
      const q = plannerSearch.toLowerCase();
      return g.name.toLowerCase().includes(q) || String(g.group_id).includes(q);
    }
    return true;
  });

  // Matrix Filtered Groups
  const filteredMatrixGroups = groups.filter((g) => {
    if (matrixFilter === 'floor1' && !(g.floor === 1 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 1))) return false;
    if (matrixFilter === 'floor2' && !(g.floor === 2 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 2))) return false;
    if (matrixFilter === 'ventilation' && g.model !== 'LC') return false;
    if (matrixSearch) {
      const q = matrixSearch.toLowerCase();
      return g.name.toLowerCase().includes(q) || String(g.group_id).includes(q);
    }
    return true;
  });

  const primaryGroup = groupMap.get(primaryGroupId);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Top Header & View Modes Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Calendar className="w-7 h-7 text-blue-500" />
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              Facility Schedule Management
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            Configure named schedule programs, layered multi-schedule subscriptions, and 7-day EEPROM routines.
          </p>
        </div>

        {/* 3-Tab Mode Switcher */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 self-start md:self-auto">
          <button
            onClick={() => handleSetMode('programs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              scheduleMode === 'programs'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Schedule Programs
            <span className="text-xs bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded-full font-mono">
              {programs.length}
            </span>
          </button>

          <button
            onClick={() => handleSetMode('planner')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              scheduleMode === 'planner'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Clock className="w-4 h-4" />
            Timeline Planner
          </button>

          <button
            onClick={() => handleSetMode('matrix')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              scheduleMode === 'matrix'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
            }`}
          >
            <Layers className="w-4 h-4" />
            Master Matrix
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMsg && (
        <div className={`p-4 rounded-xl border flex items-center justify-between text-sm transition-all ${
          statusMsg.includes('Error') 
            ? 'bg-red-500/10 border-red-500/30 text-red-300' 
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>
          <div className="flex items-center gap-2">
            {statusMsg.includes('Error') ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            <span>{statusMsg}</span>
          </div>
          <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: SCHEDULE PROGRAMS VIEW (SCHEDULE-FIRST FACILITY OVERVIEW) */}
      {/* ========================================================================= */}
      {scheduleMode === 'programs' && (
        <div className="space-y-6">
          {/* Programs Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>Modular schedule layers that can be combined and subscribed by multiple zones.</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleReconstructHardware}
                disabled={loadingPrograms || !isAdmin}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition disabled:opacity-50"
                title="Scan controller hardware and auto-cluster routines"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPrograms ? 'animate-spin' : ''}`} />
                Scan Hardware Truth
              </button>

              {isOperatorOrAdmin && (
                <button
                  onClick={handleOpenCreateProgram}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 transition"
                >
                  <Plus className="w-4 h-4" />
                  Create Schedule Program
                </button>
              )}
            </div>
          </div>

          {/* Programs Grid */}
          {loadingPrograms && programs.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
              <p>Scanning controller weekly patterns and clustering programs...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {programs.map((prog) => {
                const colorConfig = COLOR_CLASSES[prog.color] || COLOR_CLASSES.blue;
                const assignedCount = prog.assigned_group_ids.length;

                return (
                  <div
                    key={prog.id}
                    className={`bg-slate-900 border ${colorConfig.border} rounded-2xl p-6 shadow-xl flex flex-col justify-between relative overflow-hidden group transition-all hover:border-slate-600`}
                  >
                    {/* Top Header */}
                    <div>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${colorConfig.badge}`}>
                            {prog.name.slice(0, 18)}
                          </span>
                          {prog.sync_status === 'DRIFT_DETECTED' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Drift Detected
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-slate-400">
                          {isOperatorOrAdmin && (
                            <button
                              onClick={() => handleOpenEditProgram(prog)}
                              className="p-1.5 hover:bg-slate-800 hover:text-blue-400 rounded-lg transition"
                              title="Edit schedule pattern"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDeleteProgram(prog.id)}
                              className="p-1.5 hover:bg-slate-800 hover:text-red-400 rounded-lg transition"
                              title="Delete program"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <h3 className="text-lg font-bold text-slate-100 mb-1">{prog.name}</h3>
                      <p className="text-xs text-slate-400 mb-4">{prog.description || 'No description provided.'}</p>

                      {/* Weekly Mini-Timeline Bar */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 mb-4 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
                          <span>Active Schedule Layer</span>
                          <span className="text-slate-300 font-mono">{prog.weekly_hours} hrs/wk</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {DAYS_OF_WEEK.map((d) => {
                            const dayEvents = prog.weekly_pattern[d.id] || prog.weekly_pattern[String(d.id) as any] || [];
                            const hasEvents = dayEvents.length > 0;
                            const hasOn = dayEvents.some((e: any) => e.drive !== 'OFF');

                            return (
                              <div key={d.id} className="flex flex-col items-center gap-1">
                                <span className={`text-[10px] font-mono ${d.highlight ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>
                                  {d.short}
                                </span>
                                <div
                                  className={`w-full h-5 rounded flex items-center justify-center text-[10px] font-bold transition-all ${
                                    hasOn
                                      ? colorConfig.badge
                                      : hasEvents
                                      ? 'bg-slate-800 text-slate-400'
                                      : 'bg-slate-900 border border-slate-800 text-slate-600'
                                  }`}
                                  title={`${d.label}: ${dayEvents.length} events`}
                                >
                                  {hasEvents ? dayEvents.length : '—'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Assigned Zones List */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                          <span className="font-semibold text-slate-300">
                            Subscribed Zones ({assignedCount})
                          </span>
                          {isOperatorOrAdmin && (
                            <button
                              onClick={() => handleOpenAssignModal(prog)}
                              className="text-blue-400 hover:text-blue-300 text-xs font-semibold hover:underline"
                            >
                              Manage Zones →
                            </button>
                          )}
                        </div>

                        {assignedCount === 0 ? (
                          <div className="text-xs text-slate-500 italic bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/60">
                            No zones currently assigned (Template routine in library).
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                            {prog.assigned_group_ids.map((gid) => {
                              const g = groupMap.get(gid);
                              return (
                                <span
                                  key={gid}
                                  className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-200 px-2 py-0.5 rounded text-xs font-medium"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                  Zone {gid}: {g ? g.name : `Group ${gid}`}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3">
                      <button
                        onClick={() => {
                          if (prog.assigned_group_ids.length > 0) {
                            setSelectedGroupIds(prog.assigned_group_ids);
                            setPrimaryGroupId(prog.assigned_group_ids[0]);
                          }
                          handleSetMode('planner');
                        }}
                        className="text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 transition"
                      >
                        Inspect in Planner <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      {isOperatorOrAdmin && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePushProgramToHardware(prog)}
                            disabled={isSaving || assignedCount === 0}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                            title="Sync schedule program to all assigned controller zones"
                          >
                            <Send className="w-3 h-3 text-blue-400" />
                            Sync to Zones
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: WEEKLY TIMELINE PLANNER VIEW (DEEP-DIVE ZONE / DAY FOCUS) */}
      {/* ========================================================================= */}
      {scheduleMode === 'planner' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column: Zone Selector & Floor Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-100 mb-1">Target HVAC Zones</h2>
              <p className="text-xs text-slate-400">Select zones to configure schedule layers.</p>
            </div>

            {/* Quick Filters */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => applyZoneFilter('all')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              >
                All ({groups.length})
              </button>
              <button
                onClick={() => applyZoneFilter('floor1')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              >
                Floor 1
              </button>
              <button
                onClick={() => applyZoneFilter('floor2')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              >
                Floor 2
              </button>
              <button
                onClick={() => applyZoneFilter('lossnay')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              >
                LOSSNAY HRUs
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filter zones..."
                value={plannerSearch}
                onChange={(e) => setPlannerSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Zone List */}
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {filteredPlannerGroups.map((g) => {
                const isSelected = selectedGroupIds.includes(g.group_id);
                const isPrimary = primaryGroupId === g.group_id;
                const assignedPids = zoneAssignments[g.group_id] || [];
                const assignedProgsList = assignedPids.map(id => programMap.get(id)).filter(Boolean) as ScheduleProgram[];

                return (
                  <div
                    key={g.group_id}
                    onClick={() => {
                      setPrimaryGroupId(g.group_id);
                      if (!selectedGroupIds.includes(g.group_id)) {
                        setSelectedGroupIds([g.group_id]);
                      }
                    }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between text-xs ${
                      isPrimary
                        ? 'bg-blue-600/15 border-blue-500 text-slate-100 shadow-sm'
                        : isSelected
                        ? 'bg-blue-600/5 border-blue-500/40 text-slate-200'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden w-full">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          if (isSelected) {
                            if (selectedGroupIds.length > 1) {
                              setSelectedGroupIds(selectedGroupIds.filter((id) => id !== g.group_id));
                            }
                          } else {
                            setSelectedGroupIds([...selectedGroupIds, g.group_id]);
                          }
                        }}
                        className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer shrink-0"
                      />
                      <div className="truncate w-full">
                        <span className="font-semibold text-slate-200 block truncate">
                          Z{g.group_id}: {g.name}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] flex-wrap mt-0.5">
                          <span className="text-slate-500 shrink-0">
                            {g.model === 'LC' ? 'Lossnay' : `Floor ${g.floor || 1}`}
                          </span>
                          {assignedProgsList.map((ap) => (
                            <span
                              key={ap.id}
                              className={`px-1 py-0.2 rounded text-[9px] font-bold ${COLOR_CLASSES[ap.color]?.badge || COLOR_CLASSES.blue.badge}`}
                            >
                              {ap.name.slice(0, 10)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {isPrimary && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold shrink-0 ml-1">
                        Active
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: 24-Hour Timeline Planner */}
          <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            {/* Header with Zone Info and Multi-Schedule Layers */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-100">
                    {primaryGroup ? `Zone ${primaryGroup.group_id}: ${primaryGroup.name}` : `Zone ${primaryGroupId}`}
                  </h2>
                  {/* Render all assigned program badges */}
                  {currentAssignedPrograms.map((prog) => (
                    <span
                      key={prog.id}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${COLOR_CLASSES[prog.color]?.badge || COLOR_CLASSES.blue.badge}`}
                    >
                      {prog.name}
                    </span>
                  ))}
                  {currentAssignedPrograms.length === 0 && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">
                      No Program Layers
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Targeting {selectedGroupIds.length} zone(s). Layer multiple schedule routines or edit events below.
                </p>
              </div>

              {/* Action Toolbar: Layer Manager + Template Loader */}
              <div className="flex items-center gap-2 flex-wrap">
                {isOperatorOrAdmin && (
                  <button
                    onClick={handleOpenLayerModal}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md transition"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Layer Schedules ({currentAssignedPrograms.length})
                  </button>
                )}

                {isOperatorOrAdmin && programs.length > 0 && (
                  <select
                    onChange={(e) => {
                      const progId = parseInt(e.target.value, 10);
                      const prog = programs.find((p) => p.id === progId);
                      if (prog) handleLoadProgramIntoPlanner(prog);
                    }}
                    defaultValue=""
                    className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="" disabled>Load Template...</option>
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.weekly_hours} hrs/wk)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* 7-Day Selector Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
              {DAYS_OF_WEEK.map((d) => {
                const dayEvents = (weeklyPatterns[primaryGroupId]?.[d.id] || weeklyPatterns[primaryGroupId]?.[String(d.id) as any] || []);
                const onEvent = dayEvents.find((e) => e.drive !== 'OFF');
                const isSelectedDay = selectedDay === d.id;

                const tempDisplay = onEvent ? (
                  tempUnit === 'F'
                    ? (onEvent.set_temp_f ? `${onEvent.set_temp_f}°F` : (onEvent.set_temp_c ? `${Math.round((onEvent.set_temp_c * 9/5) + 32)}°F` : 'ON'))
                    : (onEvent.set_temp_c ? `${onEvent.set_temp_c}°C` : (onEvent.set_temp_f ? `${Math.round(((onEvent.set_temp_f - 32) * 5/9) * 2)/2}°C` : 'ON'))
                ) : null;

                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDay(d.id)}
                    className={`p-3 rounded-2xl font-bold text-xs text-center border transition ${
                      isSelectedDay
                        ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-900/40'
                        : 'bg-slate-950 hover:bg-slate-800/80 text-slate-300 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1 text-sm font-black">
                      {d.short}
                      {d.highlight && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>}
                    </div>
                    <div className={`text-[10px] font-mono mt-1 truncate ${isSelectedDay ? 'text-blue-100' : 'text-slate-500'}`}>
                      {dayEvents.length > 0 ? (
                        onEvent ? (
                          `${onEvent.time_str} (${tempDisplay})`
                        ) : `${dayEvents.length} Events`
                      ) : (
                        'Off / Standby'
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Visual 24-Hour Day Timeline */}
            <div className="space-y-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Merged 24-Hour Schedule
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Active HVAC conditioning blocks with layered program sources. Click any block to edit.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {isOperatorOrAdmin && (
                    <>
                      <button
                        onClick={() => {
                          setDuplicateTargetDays(DAYS_OF_WEEK.filter((d) => d.id !== selectedDay).map((d) => d.id));
                          setIsDuplicateModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Day
                      </button>

                      <button
                        onClick={() => handleOpenEventModal('planner')}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded-xl text-white shadow flex items-center gap-1.5 transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Event
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Timeline Container Bar */}
              {loadingSchedule ? (
                <div className="h-14 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-center text-xs text-slate-500 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                  Loading schedule from controller...
                </div>
              ) : (
                <div className="relative h-14 bg-slate-900 rounded-xl overflow-hidden border border-slate-800 flex shadow-inner">
                  {timelineSpans.map((span, idx) => {
                    const widthPercent = ((span.endMin - span.startMin) / 1440) * 100;
                    const isOn = span.drive === 'ON';

                    return (
                      <div
                        key={idx}
                        style={{ width: `${widthPercent}%` }}
                        onClick={() => {
                          if (span.eventIndex !== undefined && isOperatorOrAdmin) {
                            handleOpenEventModal('planner', span.eventIndex);
                          }
                        }}
                        className={`h-full flex flex-col items-center justify-center text-center p-1 transition border-r border-slate-800/80 cursor-pointer overflow-hidden ${
                          isOn
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold hover:bg-emerald-500/30'
                            : 'bg-slate-900/90 text-slate-500 font-mono hover:bg-slate-800/60'
                        }`}
                        title={`${span.startStr} - ${span.endStr}: ${span.drive}${isOn ? ` (${span.tempF}°F ${span.mode})` : ''}${span.sourceProgramName ? ` [${span.sourceProgramName}]` : ''}`}
                      >
                        <span className="text-xs truncate w-full">
                          {isOn ? (
                            `${span.startStr} ON → ${tempUnit === 'F' ? `${span.tempF}°F` : `${span.tempC}°C`}`
                          ) : (
                            widthPercent > 10 ? `${span.startStr} OFF` : 'OFF'
                          )}
                        </span>
                        {isOn && widthPercent > 15 && (
                          <span className="text-[10px] font-mono opacity-80 uppercase tracking-wider truncate">
                            {span.sourceProgramName ? `${span.sourceProgramName.slice(0, 12)}` : (span.mode || 'AUTO')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Time Markers (0 to 24) */}
              <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1 select-none">
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
            </div>

            {/* Scheduled Events List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200">
                  {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Scheduled Events ({currentDayEvents.length} / 16)
                </h3>
              </div>

              {currentDayEvents.length === 0 ? (
                <div className="bg-slate-950/60 p-8 rounded-xl border border-slate-800/80 text-center text-slate-500 text-sm">
                  No timer events scheduled for {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label}.
                  {isOperatorOrAdmin && (
                    <button
                      onClick={() => handleOpenEventModal('planner')}
                      className="block mx-auto mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300"
                    >
                      + Add First Event
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {currentDayEvents.map((ev, idx) => {
                    const isOff = ev.drive === 'OFF';
                    const isOn = !isOff;
                    const resolvedTempF = ev.set_temp_f || (ev.set_temp_c ? Math.round((ev.set_temp_c * 9/5) + 32) : null);
                    const resolvedTempC = ev.set_temp_c || (ev.set_temp_f ? Math.round(((ev.set_temp_f - 32) * 5/9) * 2)/2 : null);

                    return (
                      <div
                        key={idx}
                        className={`bg-slate-950 p-4 rounded-xl border flex items-center justify-between text-xs transition ${
                          isOn ? 'border-emerald-500/30' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`px-2.5 py-1.5 rounded-lg font-mono font-bold text-xs ${
                            isOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {ev.time_str}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 font-bold flex-wrap">
                              <span className={isOn ? 'text-emerald-300' : 'text-slate-300'}>
                                {isOn ? 'Start Climate Conditioning' : 'System Shutdown / Setback'}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                                isOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                {ev.drive || (isOn ? 'ON' : 'OFF')}
                              </span>
                              {ev.source_program_name && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-900/60 text-blue-300 border border-blue-700/50">
                                  {ev.source_program_name}
                                </span>
                              )}
                            </div>
                            {isOn && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Mode: <strong className="text-slate-200">{ev.mode || 'AUTO'}</strong>
                                {(resolvedTempF || resolvedTempC) && (
                                  <> • Setpoint: <strong className="text-emerald-300 font-mono">
                                    {tempUnit === 'F' ? `${resolvedTempF}°F` : `${resolvedTempC}°C`}
                                  </strong></>
                                )}
                                {ev.fan_speed && <> • Fan: <strong className="text-slate-200">{ev.fan_speed}</strong></>}
                                {ev.air_direction && <> • Vane: <strong className="text-slate-200">{ev.air_direction}</strong></>}
                              </p>
                            )}
                          </div>
                        </div>

                        {isOperatorOrAdmin && (
                          <div className="flex items-center gap-1.5 ml-2">
                            <button
                              onClick={() => handleOpenEventModal('planner', idx)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition"
                              title="Edit Event"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteEvent('planner', idx)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-red-400 transition"
                              title="Delete Event"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Save Action */}
            {isOperatorOrAdmin && (
              <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  Will save <strong className="text-white">{DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Schedule</strong> to <strong className="text-blue-400">{selectedGroupIds.length} selected zone(s)</strong>.
                </span>
                <button
                  onClick={handleSavePlannerToHardware}
                  disabled={isSaving || selectedGroupIds.length === 0}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : `Save ${DAYS_OF_WEEK.find(d => d.id === selectedDay)?.short} to ${selectedGroupIds.length} Zone(s)`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MASTER MATRIX GRID VIEW (AUDIT TABLE) */}
      {/* ========================================================================= */}
      {scheduleMode === 'matrix' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          {/* Search & Floor Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search zones..."
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 w-48"
                />
              </div>

              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setMatrixFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    matrixFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({groups.length})
                </button>
                <button
                  onClick={() => setMatrixFilter('floor1')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    matrixFilter === 'floor1' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Floor 1
                </button>
                <button
                  onClick={() => setMatrixFilter('floor2')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    matrixFilter === 'floor2' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Floor 2
                </button>
                <button
                  onClick={() => setMatrixFilter('ventilation')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    matrixFilter === 'ventilation' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  LOSSNAY
                </button>
              </div>
            </div>

            <button
              onClick={loadAllMatrixSchedules}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Matrix
            </button>
          </div>

          {/* Matrix Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                  <th className="py-3 px-4 font-semibold">Zone</th>
                  <th className="py-3 px-3 font-semibold">Assigned Program Layers</th>
                  {DAYS_OF_WEEK.map((d) => (
                    <th key={d.id} className={`py-3 px-3 font-semibold text-center ${d.highlight ? 'text-blue-400' : ''}`}>
                      {d.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredMatrixGroups.map((g) => {
                  const assignedPids = zoneAssignments[g.group_id] || [];
                  const assignedProgsList = assignedPids.map(id => programMap.get(id)).filter(Boolean) as ScheduleProgram[];

                  return (
                    <tr key={g.group_id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">
                          Zone {g.group_id}: {g.name}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {g.model === 'LC' ? 'Lossnay HRU' : `Floor ${g.floor || 1}`}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {assignedProgsList.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedProgsList.map((ap) => {
                              const colorConfig = COLOR_CLASSES[ap.color] || COLOR_CLASSES.blue;
                              return (
                                <span
                                  key={ap.id}
                                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${colorConfig.badge}`}
                                >
                                  {ap.name}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {DAYS_OF_WEEK.map((d) => {
                        const dayEvents = weeklyPatterns[g.group_id]?.[d.id] || weeklyPatterns[g.group_id]?.[String(d.id) as any] || [];
                        const onEvent = dayEvents.find((e) => e.drive !== 'OFF');
                        const offEvent = dayEvents.find((e) => e.drive === 'OFF');

                        return (
                          <td
                            key={d.id}
                            onClick={() => {
                              setSelectedGroupIds([g.group_id]);
                              setPrimaryGroupId(g.group_id);
                              setSelectedDay(d.id);
                              handleSetMode('planner');
                            }}
                            className="py-3 px-3 text-center cursor-pointer hover:bg-blue-600/10 transition"
                          >
                            {dayEvents.length > 0 ? (
                              <div className="inline-block bg-slate-950 px-2 py-1 rounded border border-slate-800 text-[11px] font-mono">
                                <span className="text-emerald-400 font-bold">
                                  {onEvent ? onEvent.time_str : 'ON'}
                                </span>
                                {offEvent && (
                                  <span className="text-slate-500"> → {offEvent.time_str}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600 font-mono">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: LAYER SCHEDULE PROGRAMS (PLANNER) */}
      {/* ========================================================================= */}
      {isLayerModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-blue-400" />
                  Layer Schedule Programs
                </h3>
                <p className="text-xs text-slate-400">
                  Select all schedule blocks to compose onto {selectedGroupIds.length} zone(s).
                </p>
              </div>
              <button
                onClick={() => setIsLayerModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Program Selection Checkboxes */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {programs.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-4 text-center">
                  No schedule programs created yet. Create a program in the Schedule Programs tab.
                </p>
              ) : (
                programs.map((prog) => {
                  const isChecked = layerModalSelectedPrograms.includes(prog.id);
                  const colorConfig = COLOR_CLASSES[prog.color] || COLOR_CLASSES.blue;

                  return (
                    <label
                      key={prog.id}
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition ${
                        isChecked
                          ? 'bg-blue-600/10 border-blue-500/50 shadow-sm'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setLayerModalSelectedPrograms([...layerModalSelectedPrograms, prog.id]);
                            } else {
                              setLayerModalSelectedPrograms(layerModalSelectedPrograms.filter((id) => id !== prog.id));
                            }
                          }}
                          className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-200">{prog.name}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${colorConfig.badge}`}>
                              {prog.weekly_hours} hrs/wk
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{prog.description || 'No description'}</p>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Selected <strong className="text-slate-200">{layerModalSelectedPrograms.length}</strong> layer(s).
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsLayerModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLayerAssignments}
                  disabled={isSaving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-blue-500/20"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ASSIGN ZONES TO PROGRAM (PROGRAMS TAB) */}
      {/* ========================================================================= */}
      {selectedProgramForAssign && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  Assign Zones to '{selectedProgramForAssign.name}'
                </h3>
                <p className="text-xs text-slate-400">
                  Select zones to subscribe to this schedule program in controller EEPROM.
                </p>
              </div>
              <button
                onClick={() => setSelectedProgramForAssign(null)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Filter Bar */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setAssignFilterFloor('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    assignFilterFloor === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setAssignFilterFloor('floor1')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    assignFilterFloor === 'floor1' ? 'bg-blue-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Floor 1
                </button>
                <button
                  onClick={() => setAssignFilterFloor('floor2')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    assignFilterFloor === 'floor2' ? 'bg-blue-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Floor 2
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setAssignModalSelectedZones(groups.map((g) => g.group_id))}
                  className="text-xs text-blue-400 hover:underline font-semibold"
                >
                  Select All
                </button>
                <span className="text-slate-600">|</span>
                <button
                  onClick={() => setAssignModalSelectedZones([])}
                  className="text-xs text-slate-400 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Zone Checkboxes */}
            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {groups
                .filter((g) => {
                  if (assignFilterFloor === 'floor1') return g.floor === 1 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 1);
                  if (assignFilterFloor === 'floor2') return g.floor === 2 || (!g.floor && ((g as { floor?: number }).floor ?? 1) === 2);
                  return true;
                })
                .map((g) => {
                  const isChecked = assignModalSelectedZones.includes(g.group_id);
                  return (
                    <label
                      key={g.group_id}
                      className={`p-2.5 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition ${
                        isChecked
                          ? 'bg-blue-600/10 border-blue-500/40 text-slate-100 font-semibold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignModalSelectedZones([...assignModalSelectedZones, g.group_id]);
                            } else {
                              setAssignModalSelectedZones(assignModalSelectedZones.filter((id) => id !== g.group_id));
                            }
                          }}
                          className="rounded border-slate-700 text-blue-600 focus:ring-0"
                        />
                        <span>Z{g.group_id}: {g.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {g.model === 'LC' ? 'LC' : `F${g.floor || 1}`}
                      </span>
                    </label>
                  );
                })}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Selected <strong className="text-slate-200">{assignModalSelectedZones.length}</strong> zone(s).
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedProgramForAssign(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAssignments}
                  disabled={isSaving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE / EDIT SCHEDULE PROGRAM */}
      {/* ========================================================================= */}
      {isCreateProgramOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-slate-100">
                {editingProgram ? 'Edit Schedule Program' : 'Create Schedule Program'}
              </h3>
              <button
                onClick={() => setIsCreateProgramOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metadata Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1">Program Name</label>
                <input
                  type="text"
                  placeholder="e.g. Sunday Worship & Fellowship"
                  value={programFormName}
                  onChange={(e) => setProgramFormName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Color Theme</label>
                <select
                  value={programFormColor}
                  onChange={(e) => setProgramFormColor(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="blue">Blue</option>
                  <option value="emerald">Emerald</option>
                  <option value="purple">Purple</option>
                  <option value="amber">Amber</option>
                  <option value="rose">Rose</option>
                  <option value="cyan">Cyan</option>
                  <option value="indigo">Indigo</option>
                  <option value="slate">Slate</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Sunday service climate profile for Sanctuary and Fellowship areas"
                  value={programFormDesc}
                  onChange={(e) => setProgramFormDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Daily Events Editor */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {DAYS_OF_WEEK.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setProgramEditorDay(d.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                        programEditorDay === d.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {d.short}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleOpenEventModal('programEditor')}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Event
                </button>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-48 overflow-y-auto space-y-1.5">
                {(programFormPattern[programEditorDay] || []).length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-3">No timer events for this day.</p>
                ) : (
                  (programFormPattern[programEditorDay] || []).map((ev, idx) => {
                    const isOff = ev.drive === 'OFF';
                    const isOn = !isOff;
                    const resolvedTempF = ev.set_temp_f || (ev.set_temp_c ? Math.round((ev.set_temp_c * 9/5) + 32) : null);
                    const resolvedTempC = ev.set_temp_c || (ev.set_temp_f ? Math.round(((ev.set_temp_f - 32) * 5/9) * 2)/2 : null);

                    return (
                      <div
                        key={idx}
                        className="bg-slate-900 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-bold text-slate-200">{ev.time_str}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {ev.drive || (isOn ? 'ON' : 'OFF')}
                          </span>
                          {isOn && (
                            <span className="text-blue-400 text-[10px]">
                              {ev.mode || 'AUTO'} {resolvedTempF ? `${tempUnit === 'F' ? `${resolvedTempF}°F` : `${resolvedTempC}°C`}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleOpenEventModal('programEditor', idx)} className="p-1 text-slate-400 hover:text-blue-400">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteEvent('programEditor', idx)} className="p-1 text-slate-400 hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsCreateProgramOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProgramForm}
                disabled={isSaving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Program'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT TIMER EVENT */}
      {/* ========================================================================= */}
      {isEventModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100">
                {editingEventIndex !== null ? 'Edit Timer Event' : 'Add Timer Event'}
              </h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Time Pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Hour (0-23)</label>
                <select
                  value={eventForm.hour}
                  onChange={(e) => setEventForm({ ...eventForm, hour: parseInt(e.target.value, 10) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                >
                  {Array.from({ length: 24 }).map((_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00 ({h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Minute</label>
                <select
                  value={eventForm.minute}
                  onChange={(e) => setEventForm({ ...eventForm, minute: parseInt(e.target.value, 10) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                    <option key={m} value={m}>
                      :{String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Drive State */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Power State</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEventForm({ ...eventForm, drive: 'ON' })}
                  className={`py-2 rounded-xl text-xs font-bold border transition ${
                    eventForm.drive === 'ON'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  TURN ON
                </button>
                <button
                  type="button"
                  onClick={() => setEventForm({ ...eventForm, drive: 'OFF' })}
                  className={`py-2 rounded-xl text-xs font-bold border transition ${
                    eventForm.drive === 'OFF'
                      ? 'bg-red-600/20 border-red-500 text-red-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  TURN OFF
                </button>
              </div>
            </div>

            {/* Mode & Setpoint (if ON) */}
            {eventForm.drive === 'ON' && (
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Mode</label>
                    <select
                      value={eventForm.mode}
                      onChange={(e) => setEventForm({ ...eventForm, mode: e.target.value as OperationMode })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="AUTO">AUTO</option>
                      <option value="HEAT">HEAT</option>
                      <option value="COOL">COOL</option>
                      <option value="FAN">FAN</option>
                      <option value="DRY">DRY</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Target Temp ({tempUnit})</label>
                    <input
                      type="number"
                      step={tempUnit === 'F' ? 1 : 0.5}
                      min={tempUnit === 'F' ? 62 : 17}
                      max={tempUnit === 'F' ? 86 : 30}
                      value={tempUnit === 'F' ? eventForm.set_temp_f : eventForm.set_temp_c}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (tempUnit === 'F') {
                          setEventForm({
                            ...eventForm,
                            set_temp_f: val,
                            set_temp_c: Math.round(((val - 32) * 5/9) * 2) / 2,
                          });
                        } else {
                          setEventForm({
                            ...eventForm,
                            set_temp_c: val,
                            set_temp_f: Math.round((val * 9/5) + 32),
                          });
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEvent}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition"
              >
                Apply Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DUPLICATE DAY */}
      {/* ========================================================================= */}
      {isDuplicateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100">
                Duplicate {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.label} Schedule
              </h3>
              <button onClick={() => setIsDuplicateModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">Select target days to copy this day's timer events:</p>

            <div className="space-y-1.5">
              {DAYS_OF_WEEK.filter((d) => d.id !== selectedDay).map((d) => {
                const isChecked = duplicateTargetDays.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className={`p-2 rounded-xl border flex items-center justify-between text-xs cursor-pointer ${
                      isChecked ? 'bg-blue-600/10 border-blue-500 text-slate-200' : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setDuplicateTargetDays([...duplicateTargetDays, d.id]);
                          } else {
                            setDuplicateTargetDays(duplicateTargetDays.filter((id) => id !== d.id));
                          }
                        }}
                        className="rounded border-slate-700 text-blue-600"
                      />
                      <span>{d.label}</span>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsDuplicateModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDuplicateDay}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold"
              >
                Copy to Selected Days
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleView;
