import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Layers, 
  Wind, 
  AlertCircle,
  Sliders,
  CheckSquare,
  Power,
  Unlock,
  Lock,
  X
} from 'lucide-react';
import { GroupStatus, GroupControlRequest } from '../types';
import { ZoneCard } from './ZoneCard';
import { BulkEditModal } from './BulkEditModal';
import { useAuth } from '../AuthContext';

interface DashboardProps {
  groups: GroupStatus[];
  tempUnit: 'F' | 'C';
  onTogglePower: (group: GroupStatus) => void;
  onOpenDetails: (group: GroupStatus) => void;
  onResetFilter: (groupId: number) => void;
  onBatchControl: (updates: Record<number, GroupControlRequest>) => Promise<void>;
  initialFilter?: string;
  onFilterChange?: (filter: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  groups,
  tempUnit,
  onTogglePower,
  onOpenDetails,
  onResetFilter,
  onBatchControl,
  initialFilter,
  onFilterChange,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFloor, setFilterFloor] = useState<'all' | 'floor1' | 'floor2' | 'lossnay' | 'running' | 'dirty'>(
    (initialFilter as any) || 'all'
  );

  // Bulk Edit / Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [isBatchActionLoading, setIsBatchActionLoading] = useState(false);

  useEffect(() => {
    if (initialFilter) {
      setFilterFloor(initialFilter as any);
    }
  }, [initialFilter]);

  const handleSelectFilter = (id: string) => {
    setFilterFloor(id as any);
    onFilterChange?.(id);
  };

  // Categorize units
  const floor1Groups = useMemo(() => groups.filter((g) => (g.floor ?? (((g as { floor?: number }).floor ?? 1) === 1 ? 1 : 2)) === 1), [groups]);
  const floor2Groups = useMemo(() => groups.filter((g) => (g.floor ?? (((g as { floor?: number }).floor ?? 1) === 1 ? 1 : 2)) === 2), [groups]);
  const lossnayGroups = useMemo(() => groups.filter((g) => g.model === 'LC'), [groups]);
  const acGroups = useMemo(() => groups.filter((g) => g.model !== 'LC'), [groups]);
  const runningGroups = useMemo(() => groups.filter((g) => g.drive === 'ON'), [groups]);
  const dirtyFilterGroups = useMemo(() => groups.filter((g) => g.filter_dirty), [groups]);

  // Filtered display list
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      // Search query filter
      const matchesSearch =
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `group ${g.group_id}`.includes(searchQuery.toLowerCase()) ||
        `m${g.address}`.includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      // Category filter
      const groupFloor = g.floor ?? (((g as { floor?: number }).floor ?? 1) === 1 ? 1 : 2);
      if (filterFloor === 'floor1') return groupFloor === 1;
      if (filterFloor === 'floor2') return groupFloor === 2;
      if (filterFloor === 'lossnay') return g.model === 'LC';
      if (filterFloor === 'running') return g.drive === 'ON';
      if (filterFloor === 'dirty') return g.filter_dirty;

      return true;
    });
  }, [groups, searchQuery, filterFloor]);

  // Determine active device type for bulk selection (IC vs LC)
  const activeDeviceType = useMemo<'IC' | 'LC' | null>(() => {
    if (selectedGroupIds.size === 0) return null;
    const firstId = Array.from(selectedGroupIds)[0];
    const firstGroup = groups.find((g) => g.group_id === firstId);
    return firstGroup?.model === 'LC' ? 'LC' : 'IC';
  }, [selectedGroupIds, groups]);

  // Map selected IDs to GroupStatus objects
  const selectedGroups = useMemo(() => {
    return groups.filter((g) => selectedGroupIds.has(g.group_id));
  }, [groups, selectedGroupIds]);

  // Toggle selection for a single group
  const handleToggleSelect = (group: GroupStatus) => {
    const isLossnay = group.model === 'LC';
    const groupType = isLossnay ? 'LC' : 'IC';

    if (activeDeviceType && activeDeviceType !== groupType && !selectedGroupIds.has(group.group_id)) {
      return; // Cannot mix different device types
    }

    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(group.group_id)) {
        next.delete(group.group_id);
      } else {
        next.add(group.group_id);
      }
      return next;
    });
  };

  // Quick selection helpers
  const handleSelectAllAC = () => {
    setIsSelectionMode(true);
    setSelectedGroupIds(new Set(acGroups.map((g) => g.group_id)));
  };

  const handleSelectAllLossnay = () => {
    setIsSelectionMode(true);
    setSelectedGroupIds(new Set(lossnayGroups.map((g) => g.group_id)));
  };

  const handleSelectAllInView = () => {
    setIsSelectionMode(true);
    if (filteredGroups.length === 0) return;
    const targetType = activeDeviceType || (filteredGroups[0].model === 'LC' ? 'LC' : 'IC');
    const matchingInView = filteredGroups.filter((g) => (g.model === 'LC' ? 'LC' : 'IC') === targetType);
    setSelectedGroupIds(new Set(matchingInView.map((g) => g.group_id)));
  };

  const handleClearSelection = () => {
    setSelectedGroupIds(new Set());
  };

  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedGroupIds(new Set());
  };

  // Quick mass action handler (Power ON/OFF, Wall Remote Lock/Unlock)
  const handleQuickBatch = async (partialReq: GroupControlRequest) => {
    if (selectedGroupIds.size === 0 || isViewer) return;
    setIsBatchActionLoading(true);
    try {
      const batch: Record<number, GroupControlRequest> = {};
      for (const id of selectedGroupIds) {
        batch[id] = { ...partialReq };
      }
      await onBatchControl(batch);
    } finally {
      setIsBatchActionLoading(false);
    }
  };

  // Quick floor batch controls
  const handleFloorBatch = async (floor: 'floor1' | 'floor2', driveState: 'ON' | 'OFF') => {
    const targetGroups = floor === 'floor1' ? floor1Groups : floor2Groups;
    const batch: Record<number, GroupControlRequest> = {};
    for (const g of targetGroups) {
      batch[g.group_id] = { drive: driveState };
    }
    await onBatchControl(batch);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Floor Quick Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Floor 1 Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <h3 className="font-bold text-slate-100 text-sm">Floor 1</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {floor1Groups.length} Units • <strong className="text-emerald-400">{floor1Groups.filter((g) => g.drive === 'ON').length} Active</strong>
            </p>
          </div>
          {!isViewer && (
            <div className="flex gap-1.5">
              <button
                onClick={() => handleFloorBatch('floor1', 'ON')}
                className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
              >
                All ON
              </button>
              <button
                onClick={() => handleFloorBatch('floor1', 'OFF')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-semibold transition"
              >
                All OFF
              </button>
            </div>
          )}
        </div>

        {/* Floor 2 Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <h3 className="font-bold text-slate-100 text-sm">Floor 2</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {floor2Groups.length} Units • <strong className="text-emerald-400">{floor2Groups.filter((g) => g.drive === 'ON').length} Active</strong>
            </p>
          </div>
          {!isViewer && (
            <div className="flex gap-1.5">
              <button
                onClick={() => handleFloorBatch('floor2', 'ON')}
                className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold transition"
              >
                All ON
              </button>
              <button
                onClick={() => handleFloorBatch('floor2', 'OFF')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-semibold transition"
              >
                All OFF
              </button>
            </div>
          )}
        </div>

        {/* Ventilation Summary Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <Wind className="w-4 h-4 text-teal-400" />
              <h3 className="font-bold text-slate-100 text-sm">Ventilation (LOSSNAY)</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {lossnayGroups.length} Energy Recovery Units • <strong className="text-emerald-400">{lossnayGroups.filter((g) => g.drive === 'ON').length} Active</strong>
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 bg-teal-500/10 text-teal-300 border border-teal-500/20 rounded-lg font-medium">
            Interlocked Auto
          </span>
        </div>
      </div>

      {/* Search, Filter, and Bulk Edit Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
          {/* Search Input */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by zone name or group #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full lg:w-auto pb-1 lg:pb-0">
            {[
              { id: 'all', label: `All (${groups.length})` },
              { id: 'running', label: `Active (${runningGroups.length})` },
              { id: 'floor1', label: `Floor 1 (${floor1Groups.length})` },
              { id: 'floor2', label: `Floor 2 (${floor2Groups.length})` },
              { id: 'lossnay', label: `Ventilation (${lossnayGroups.length})` },
              { id: 'dirty', label: `Filters (${dirtyFilterGroups.length})` },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleSelectFilter(id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                  filterFloor === id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bulk Edit Mode Toggle Button */}
          {!isViewer && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isSelectionMode) {
                    handleExitSelectionMode();
                  } else {
                    setIsSelectionMode(true);
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition border ${
                  isSelectionMode
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{isSelectionMode ? 'Exit Bulk Select' : 'Bulk Select & Edit'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Bulk Selection Helper Bar (Visible when in selection mode) */}
        {isSelectionMode && (
          <div className="bg-blue-950/30 border border-blue-500/30 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs animate-fadeIn">
            <div className="flex items-center gap-2 text-slate-300">
              <CheckSquare className="w-4 h-4 text-blue-400" />
              <span>
                Select zones to mass-update. <strong>Note:</strong> Bulk edits apply across devices of the same type.
              </span>
              {activeDeviceType && (
                <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 border border-blue-500/30 text-[11px] font-mono">
                  Locked to: {activeDeviceType === 'LC' ? 'LOSSNAY Ventilators' : 'Indoor AC Units'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAllAC}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition"
              >
                All AC Units ({acGroups.length})
              </button>
              <button
                onClick={handleSelectAllLossnay}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition"
              >
                All Ventilators ({lossnayGroups.length})
              </button>
              <button
                onClick={handleSelectAllInView}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition"
              >
                All in View
              </button>
              {selectedGroupIds.size > 0 && (
                <button
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 text-slate-400 hover:text-slate-200 transition underline"
                >
                  Clear Selection
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Zone Cards Grid */}
      {filteredGroups.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredGroups.map((group) => {
            const isLossnay = group.model === 'LC';
            const groupType = isLossnay ? 'LC' : 'IC';
            const isDisabledSelection = isSelectionMode && activeDeviceType !== null && activeDeviceType !== groupType;
            const isSelected = selectedGroupIds.has(group.group_id);

            return (
              <ZoneCard
                key={group.group_id}
                group={group}
                tempUnit={tempUnit}
                onTogglePower={onTogglePower}
                onOpenDetails={onOpenDetails}
                onResetFilter={onResetFilter}
                isSelectionMode={isSelectionMode}
                isSelected={isSelected}
                isDisabledSelection={isDisabledSelection}
                onToggleSelect={handleToggleSelect}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
          <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <h4 className="text-slate-300 font-bold text-sm">No HVAC zones match your filter</h4>
          <p className="text-slate-500 text-xs mt-1">Try changing your search query or filter category.</p>
        </div>
      )}

      {/* Floating Action Bar for Selected Zones */}
      {isSelectionMode && selectedGroupIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-4 animate-slideUp">
          <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-2xl rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            {/* Selection Summary */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-blue-600/20 text-blue-300 px-3 py-1 rounded-xl border border-blue-500/30 text-xs font-bold">
                <CheckSquare className="w-4 h-4" />
                <span>{selectedGroupIds.size} {activeDeviceType === 'LC' ? 'Ventilators' : 'A/C Zones'} Selected</span>
              </div>
            </div>

            {/* Quick Batch Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleQuickBatch({ drive: 'ON' })}
                disabled={isBatchActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition"
                title="Turn all selected units ON"
              >
                <Power className="w-3.5 h-3.5" />
                All ON
              </button>

              <button
                onClick={() => handleQuickBatch({ drive: 'OFF' })}
                disabled={isBatchActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold transition"
                title="Turn all selected units OFF"
              >
                <Power className="w-3.5 h-3.5" />
                All OFF
              </button>

              <button
                onClick={() => handleQuickBatch({ remote_lock: 'PERMIT' })}
                disabled={isBatchActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold transition"
                title="Allow wall thermostat adjustments on selected units"
              >
                <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                Unlock Wall Remotes
              </button>

              <button
                onClick={() => handleQuickBatch({ remote_lock: 'PROHIBIT' })}
                disabled={isBatchActionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold transition"
                title="Lock wall thermostats on selected units"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                Lock Wall Remotes
              </button>

              <button
                onClick={() => setIsBulkEditModalOpen(true)}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-950 transition"
              >
                <Sliders className="w-3.5 h-3.5" />
                Bulk Edit Settings...
              </button>

              <button
                onClick={handleClearSelection}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
                title="Clear Selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {isBulkEditModalOpen && (
        <BulkEditModal
          selectedGroups={selectedGroups}
          tempUnit={tempUnit}
          onClose={() => setIsBulkEditModalOpen(false)}
          onApply={async (updates) => {
            await onBatchControl(updates);
            handleClearSelection();
          }}
        />
      )}
    </div>
  );
};

