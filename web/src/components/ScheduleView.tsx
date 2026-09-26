import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, 
  Layers, 
  Plus, 
  Search, 
  Copy, 
  Trash2, 
  RefreshCw, 
  Sun, 
  AlertTriangle 
} from 'lucide-react';
import { 
  GroupStatus, 
  ScheduleProgram, 
  SeasonConfig, 
  PublishProgress,
  SeasonReconcileStatus 
} from '../types';
import { 
  fetchSchedulePrograms, 
  createScheduleProgram, 
  updateScheduleProgram, 
  deleteScheduleProgram, 
  duplicateProgram, 
  fetchAllZoneAssignments, 
  fetchZoneMergedSchedule, 
  fetchSeasons, 
  checkSeasonReconciliation, 
  publishScheduleStream,
  reconstructSchedulesFromHardware,
  cloneSeason
} from '../api';
import { useAuth } from '../AuthContext';
import { DestructiveConfirmModal } from './DestructiveConfirmModal';
import { SeasonTimelineModal } from './SeasonTimelineModal';
import { SeasonCloneModal } from './SeasonCloneModal';
import { SeasonReconcileModal } from './SeasonReconcileModal';
import { CoherentScheduleEditor } from './CoherentScheduleEditor';
import { WeekMatrixView } from './WeekMatrixView';
import { formatDaysSummary } from '../utils/scheduleHelpers';

export type ScheduleMode = 'schedules' | 'matrix' | 'overview' | 'new' | 'review' | 'programs' | 'planner';

interface ScheduleViewProps {
  groups: GroupStatus[];
  tempUnit: 'F' | 'C';
  activeMode?: ScheduleMode;
  onModeChange?: (mode: ScheduleMode) => void;
}

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

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  groups,
  tempUnit,
  activeMode,
  onModeChange,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'operator';

  // Normalize mode to either 'schedules' or 'matrix'
  const normalizedActiveMode = (activeMode === 'matrix') ? 'matrix' : 'schedules';
  const [scheduleMode, setScheduleMode] = useState<'schedules' | 'matrix'>(normalizedActiveMode);

  useEffect(() => {
    if (activeMode) {
      const next = (activeMode === 'matrix') ? 'matrix' : 'schedules';
      if (next !== scheduleMode) {
        setScheduleMode(next);
      }
    }
  }, [activeMode]);

  const handleSetMode = (mode: 'schedules' | 'matrix') => {
    setScheduleMode(mode);
    onModeChange?.(mode);
  };

  // --- Core Data State ---
  const [programs, setPrograms] = useState<ScheduleProgram[]>([]);
  const [zoneAssignments, setZoneAssignments] = useState<Record<number, number[]>>({});
  const [weeklyPatterns, setWeeklyPatterns] = useState<Record<number, Record<number, any[]>>>({});
  const [seasons, setSeasons] = useState<SeasonConfig[]>([]);
  const [seasonReconciliation, setSeasonReconciliation] = useState<SeasonReconcileStatus | null>(null);

  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null);

  // Active Schedule Selection in Editor Hub
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | 'new' | null>(null);
  const [scheduleSearch, setScheduleSearch] = useState('');

  // Modals
  const [isSeasonToolsModalOpen, setIsSeasonToolsModalOpen] = useState(false);
  const [isSeasonTimelineModalOpen, setIsSeasonTimelineModalOpen] = useState(false);
  const [isSeasonCloneModalOpen, setIsSeasonCloneModalOpen] = useState(false);
  const [isSeasonReconcileModalOpen, setIsSeasonReconcileModalOpen] = useState(false);
  const [isReconstructModalOpen, setIsReconstructModalOpen] = useState(false);
  const [deleteConfirmProgram, setDeleteConfirmProgram] = useState<ScheduleProgram | null>(null);

  // --- Load Data ---
  const loadPrograms = async () => {
    setLoadingPrograms(true);
    try {
      const [progs, assigns] = await Promise.all([
        fetchSchedulePrograms(),
        fetchAllZoneAssignments().catch(() => ({})),
      ]);
      setPrograms(progs);
      setZoneAssignments(assigns);

      // Default selection if none selected yet
      if (selectedScheduleId === null && progs.length > 0) {
        setSelectedScheduleId(progs[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load schedule programs:', err);
    } finally {
      setLoadingPrograms(false);
    }
  };

  const loadSeasons = async () => {
    try {
      const list = await fetchSeasons();
      setSeasons(list);
    } catch (err) {
      console.error('Failed to load seasons:', err);
    }
  };

  const loadSeasonReconciliation = async () => {
    try {
      const res = await checkSeasonReconciliation();
      setSeasonReconciliation(res);
    } catch (err) {
      console.warn('Failed to check season reconciliation:', err);
    }
  };

  const loadWeeklyScheduleForGroup = async (groupId: number) => {
    if (!groupId) return;
    try {
      const mergedData = await fetchZoneMergedSchedule(groupId);
      setWeeklyPatterns((prev) => ({
        ...prev,
        [groupId]: mergedData.merged_pattern || { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
      }));
    } catch (err) {
      console.error(`Failed to load weekly schedule for group ${groupId}:`, err);
    }
  };

  const loadAllMatrixSchedules = async () => {
    setLoadingSchedule(true);
    try {
      for (const g of groups) {
        await loadWeeklyScheduleForGroup(g.group_id);
      }
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => {
    loadPrograms();
    loadSeasons();
    loadSeasonReconciliation();
  }, []);

  useEffect(() => {
    if (scheduleMode === 'matrix') {
      loadAllMatrixSchedules();
    }
  }, [scheduleMode, groups]);

  // Selected schedule object
  const currentSelectedSchedule = useMemo(() => {
    if (selectedScheduleId === 'new') return null;
    return programs.find(p => p.id === selectedScheduleId) || null;
  }, [selectedScheduleId, programs]);

  // Filtered schedules for left panel list
  const filteredScheduleList = useMemo(() => {
    if (!scheduleSearch.trim()) return programs;
    const q = scheduleSearch.toLowerCase();
    return programs.filter(p => (p.name || '').toLowerCase().includes(q));
  }, [programs, scheduleSearch]);

  // --- Save / Publish Handler ---
  const handleSaveSchedule = async (payload: any, flashToHardware: boolean) => {
    setIsSaving(true);
    setPublishProgress(null);
    try {
      let savedProg: ScheduleProgram;

      // Detect removed zones if editing an existing schedule
      const oldProg = payload.id ? programs.find((p) => p.id === payload.id) : undefined;
      const oldGids = new Set<number>(oldProg?.assigned_group_ids || []);
      const newGids = new Set<number>(payload.assigned_group_ids || []);
      const removedGids = Array.from(oldGids).filter((gid) => !newGids.has(gid));

      if (payload.id) {
        savedProg = await updateScheduleProgram(payload.id, {
          name: payload.name,
          description: payload.description,
          color: payload.color,
          season_id: payload.season_id,
          season_scope: payload.season_scope,
          weekly_pattern: payload.weekly_pattern,
          assigned_group_ids: payload.assigned_group_ids,
          metadata_json: payload.metadata_json,
          publish_to_hardware: false,
        });
      } else {
        savedProg = await createScheduleProgram({
          name: payload.name,
          description: payload.description,
          color: payload.color,
          season_id: payload.season_id,
          season_scope: payload.season_scope,
          weekly_pattern: payload.weekly_pattern,
          assigned_group_ids: payload.assigned_group_ids,
          metadata_json: payload.metadata_json,
          publish_to_hardware: false,
        });
      }

      // If flash requested, stream progress to hardware EEPROM (including flashing assigned and clearing removed)
      const allSyncGids = [...(savedProg.assigned_group_ids || []), ...removedGids];
      if (flashToHardware && allSyncGids.length > 0) {
        setPublishProgress({
          schedule_id: savedProg.id,
          schedule_name: savedProg.name,
          current: 0,
          total: allSyncGids.length,
          percent: 0,
          status: 'flashing',
          successful_count: 0,
          failed_count: 0,
          room_statuses: Object.fromEntries(allSyncGids.map(id => [id, 'queued'])),
        });

        await publishScheduleStream(
          savedProg.id,
          (prog) => {
            setPublishProgress({ ...prog });
          },
          removedGids
        );
      }

      await loadPrograms();
      setSelectedScheduleId(savedProg.id);

      // Immediately clear or reload pattern caches for removed rooms
      if (removedGids.length > 0) {
        setWeeklyPatterns((prev) => {
          const next = { ...prev };
          for (const gid of removedGids) {
            next[gid] = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
          }
          return next;
        });
        for (const gid of removedGids) {
          loadWeeklyScheduleForGroup(gid);
        }
      }

      // Refresh weekly pattern caches for affected rooms
      if (savedProg.assigned_group_ids) {
        for (const gid of savedProg.assigned_group_ids) {
          loadWeeklyScheduleForGroup(gid);
        }
      }
    } catch (err: any) {
      console.error('Failed to save schedule:', err);
      alert(`Error saving schedule: ${err.message || err}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setPublishProgress(null), 3000);
    }
  };

  // --- Duplicate Handler ---
  const handleDuplicateSchedule = async (prog: ScheduleProgram) => {
    setIsSaving(true);
    try {
      const dup = await duplicateProgram(prog.id, {
        target_season_id: prog.season_id || 1,
        name_suffix: ' (Copy)',
        mode_transformation: 'NONE',
        setpoint_offset_f: 0,
      });
      await loadPrograms();
      setSelectedScheduleId(dup.id);
    } catch (err: any) {
      console.error('Failed to duplicate schedule:', err);
      alert(`Error duplicating schedule: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Delete Handler ---
  const handleConfirmDelete = async () => {
    if (!deleteConfirmProgram) return;
    setIsSaving(true);
    try {
      await deleteScheduleProgram(deleteConfirmProgram.id);
      await loadPrograms();
      setSelectedScheduleId((prev) => (prev === deleteConfirmProgram.id ? (programs[0]?.id || 'new') : prev));
      setDeleteConfirmProgram(null);
    } catch (err: any) {
      console.error('Failed to delete schedule:', err);
      alert(`Error deleting schedule: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Scan Hardware Truth ---
  const handleScanHardware = async () => {
    setLoadingPrograms(true);
    try {
      await reconstructSchedulesFromHardware();
      await loadPrograms();
      await loadAllMatrixSchedules();
      setIsSeasonToolsModalOpen(false);
      alert('Hardware schedules successfully scanned and clustered!');
    } catch (err: any) {
      console.error('Failed to scan hardware:', err);
      alert(`Scan failed: ${err.message || err}`);
    } finally {
      setLoadingPrograms(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Top Header & Two-Tab Navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2.5">
              <Calendar className="w-5 h-5 text-blue-400" />
              <span>Facility Scheduling</span>
            </h1>
            <p className="text-xs text-slate-400">
              Configure room schedules, occupied events, and view facility coverage across the week.
            </p>
          </div>

          {/* Right Tools: Seasons & Hardware Diagnostics */}
          <div className="flex items-center gap-2">
            {seasonReconciliation && !seasonReconciliation.reconciled && (
              <button
                type="button"
                onClick={() => setIsSeasonReconcileModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/40 rounded-xl text-xs font-semibold animate-pulse cursor-pointer"
                title="Season calendar dates require alignment"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Reconcile Seasons</span>
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsReconstructModalOpen(true)}
                disabled={loadingPrograms}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer disabled:opacity-50"
                title="Scan GB-50 controller hardware and auto-cluster routines into named programs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPrograms ? 'animate-spin text-blue-400' : 'text-blue-400'}`} />
                <span>Reconstruct from Hardware</span>
              </button>
            )}

            {isOperatorOrAdmin && (
              <button
                type="button"
                onClick={() => setIsSeasonToolsModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                title="Configure 5-season calendar dates and clone routines"
              >
                <Sun className="w-4 h-4 text-amber-400" />
                <span>Seasons &amp; Tools...</span>
              </button>
            )}
          </div>
        </div>

        {/* The Two Core Tabs */}
        <div className="schedule-nav-tabs">
          <button
            type="button"
            onClick={() => handleSetMode('schedules')}
            className={`nav-tab ${scheduleMode === 'schedules' ? 'active' : ''}`}
          >
            <Calendar className="w-4 h-4" />
            <span>Schedules</span>
            <span className="tab-badge">{programs.length}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSetMode('matrix')}
            className={`nav-tab ${scheduleMode === 'matrix' ? 'active' : ''}`}
          >
            <Layers className="w-4 h-4" />
            <span>Week Matrix</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: SCHEDULES (MASTER-DETAIL COHERENT SCHEDULE HUB & EDITOR) */}
      {/* ========================================================================= */}
      {scheduleMode === 'schedules' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Schedules List Cards (4 cols on lg) */}
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Schedules ({programs.length})</h3>
                <p className="text-[11px] text-slate-500">Select to edit or create new.</p>
              </div>

              {isOperatorOrAdmin && (
                <button
                  type="button"
                  onClick={() => setSelectedScheduleId('new')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              )}
            </div>

            {/* Quick Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filter schedules..."
                value={scheduleSearch}
                onChange={(e) => setScheduleSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Schedules Card List */}
            <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
              {loadingPrograms && programs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-500" />
                  Loading schedules...
                </div>
              ) : filteredScheduleList.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/60">
                  No schedules match your search.
                </div>
              ) : (
                filteredScheduleList.map((prog) => {
                  const isSelected = selectedScheduleId === prog.id;
                  const colorConfig = COLOR_CLASSES[prog.color] || COLOR_CLASSES.blue;
                  const roomCount = prog.assigned_group_ids?.length || 0;
                  const daysList = prog.metadata_json?.days || [];
                  const daysStr = daysList.length > 0 ? formatDaysSummary(daysList) : 'Pattern';

                  return (
                    <div
                      key={prog.id}
                      onClick={() => setSelectedScheduleId(prog.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition relative overflow-hidden select-none ${
                        isSelected
                          ? `bg-slate-800/90 ${colorConfig.border} ring-1 ring-blue-500/50 shadow-md`
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60'
                      }`}
                    >
                      {/* Left accent color strip */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${colorConfig.badge.split(' ')[0]}`} />

                      <div className="flex items-start justify-between gap-2 mb-1.5 pl-1">
                        <div className="truncate">
                          <h4 className="text-xs font-bold text-slate-100 truncate">
                            {prog.name}
                          </h4>
                          <span className="text-[10px] text-slate-400 block truncate">
                            {daysStr}
                          </span>
                        </div>

                        {/* Actions on Card */}
                        <div className="flex items-center gap-1 shrink-0 text-slate-400">
                          {isOperatorOrAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateSchedule(prog);
                              }}
                              className="p-1 hover:bg-slate-800 hover:text-indigo-300 rounded"
                              title="Duplicate schedule"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmProgram(prog);
                              }}
                              className="p-1 hover:bg-slate-800 hover:text-red-400 rounded"
                              title="Delete schedule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pill Badges */}
                      <div className="flex items-center gap-1.5 flex-wrap pl-1 mt-2 text-[10px]">
                        <span className="bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                          {roomCount} {roomCount === 1 ? 'room' : 'rooms'}
                        </span>
                        {prog.weekly_hours > 0 && (
                          <span className="bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                            {prog.weekly_hours} hrs/wk
                          </span>
                        )}
                        {prog.sync_status === 'DRIFT_DETECTED' && (
                          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold">
                            Drift
                          </span>
                        )}
                        {prog.sync_status === 'SYNCED' && (
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded font-bold">
                            Synced
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: In-Place Coherent Schedule Editor (8 cols on lg) */}
          <div className="lg:col-span-8">
            <CoherentScheduleEditor
              schedule={currentSelectedSchedule}
              groups={groups}
              seasons={seasons}
              allPrograms={programs}
              tempUnit={tempUnit}
              onSave={handleSaveSchedule}
              onDelete={(prog) => setDeleteConfirmProgram(prog)}
              onCancel={() => {
                if (programs.length > 0) {
                  setSelectedScheduleId(programs[0].id);
                }
              }}
              isSaving={isSaving}
              publishProgress={publishProgress}
            />
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: WEEK MATRIX (ALL ROOMS X FULL WEEK AT A GLANCE) */}
      {/* ========================================================================= */}
      {scheduleMode === 'matrix' && (
        <WeekMatrixView
          groups={groups}
          programs={programs}
          zoneAssignments={zoneAssignments}
          weeklyPatterns={weeklyPatterns}
          tempUnit={tempUnit}
          onSelectSchedule={(prog) => {
            setSelectedScheduleId(prog.id);
            handleSetMode('schedules');
          }}
          onRefresh={loadAllMatrixSchedules}
          loading={loadingSchedule}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: SEASONS & HARDWARE TOOLS DIALOG */}
      {/* ========================================================================= */}
      {isSeasonToolsModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Sun className="w-5 h-5 text-amber-400" />
                  <span>Seasons &amp; Controller Hardware Tools</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Global calendar season schedules, cloning, and hardware truth diagnostics.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSeasonToolsModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {/* Season Dates Configuration */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-200">5-Season Calendar Dates</h4>
                  <p className="text-[11px] text-slate-400">
                    Define start and end calendar months/days for Summer, Winter, Spring, and Fall seasons.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsSeasonToolsModalOpen(false);
                    setIsSeasonTimelineModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                >
                  Configure Dates...
                </button>
              </div>

              {/* Clone Season Tool */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Clone Season Schedules</h4>
                  <p className="text-[11px] text-slate-400">
                    Duplicate all routines from Summer to Winter with automatic COOL to HEAT mode transformation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsSeasonToolsModalOpen(false);
                    setIsSeasonCloneModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                >
                  Clone Season...
                </button>
              </div>

              {/* Scan Hardware Truth */}
              {isAdmin && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">Scan Hardware Truth</h4>
                    <p className="text-[11px] text-slate-400">
                      Directly read GB-50 EEPROM weekly pattern registers and auto-cluster routines into named programs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleScanHardware}
                    disabled={loadingPrograms}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingPrograms ? 'animate-spin' : ''}`} />
                    Scan Hardware
                  </button>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsSeasonToolsModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SEASON TIMELINE MODAL */}
      {/* ========================================================================= */}
      <SeasonTimelineModal
        isOpen={isSeasonTimelineModalOpen}
        onClose={() => setIsSeasonTimelineModalOpen(false)}
        seasons={seasons}
        onSaveSeasons={async () => {
          await loadSeasons();
        }}
      />

      {/* ========================================================================= */}
      {/* SEASON CLONE MODAL */}
      {/* ========================================================================= */}
      <SeasonCloneModal
        isOpen={isSeasonCloneModalOpen}
        onClose={() => setIsSeasonCloneModalOpen(false)}
        seasons={seasons}
        programs={programs}
        activeSeasonId={1}
        onCloneSeason={async (sourceId, targetId, req) => {
          await cloneSeason(sourceId, targetId, req);
          await loadPrograms();
          await loadAllMatrixSchedules();
        }}
      />

      {/* ========================================================================= */}
      {/* SEASON RECONCILE MODAL */}
      {/* ========================================================================= */}
      <SeasonReconcileModal
        isOpen={isSeasonReconcileModalOpen}
        onClose={() => setIsSeasonReconcileModalOpen(false)}
        status={seasonReconciliation}
        onReconciled={async () => {
          await loadSeasons();
          await loadSeasonReconciliation();
        }}
      />

      {/* ========================================================================= */}
      {/* DESTRUCTIVE CONFIRM MODAL: DELETE PROGRAM */}
      {/* ========================================================================= */}
      <DestructiveConfirmModal
        isOpen={deleteConfirmProgram !== null}
        onClose={() => setDeleteConfirmProgram(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Schedule Program"
        description={`You are about to delete schedule "${deleteConfirmProgram?.name}". Assigned zones will no longer follow this routine.`}
        itemName={deleteConfirmProgram?.name || ''}
        confirmButtonText="Delete Schedule Program"
      />

      {/* ========================================================================= */}
      {/* DESTRUCTIVE CONFIRM MODAL: RECONSTRUCT FROM HARDWARE */}
      {/* ========================================================================= */}
      <DestructiveConfirmModal
        isOpen={isReconstructModalOpen}
        onClose={() => setIsReconstructModalOpen(false)}
        onConfirm={async () => {
          await handleScanHardware();
          setIsReconstructModalOpen(false);
        }}
        title="Scan & Reconstruct Schedules from Hardware Truth?"
        itemName="RECONSTRUCT"
        confirmButtonText="Scan & Reconstruct Database"
        confirmInputPlaceholder="Type RECONSTRUCT to confirm"
        isLoading={loadingPrograms}
        description={
          <div>
            <p>
              This will query all physical zones on the GB-50 controller, identify distinct weekly schedule routines, cluster identical patterns into named programs, and rebuild the database from hardware ground truth.
            </p>
            <p className="text-amber-400 font-medium pt-2">
              Warning: Any unassigned or conflicting local schedule definitions will be replaced with actual controller state.
            </p>
          </div>
        }
      />
    </div>
  );
};
