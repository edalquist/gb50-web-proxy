import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Layers, 
  Wind, 
  AlertCircle
} from 'lucide-react';
import { GroupStatus, GroupControlRequest } from '../types';
import { ZoneCard } from './ZoneCard';
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
              14 AC Units • <strong className="text-emerald-400">{floor1Groups.filter((g) => g.drive === 'ON').length} Active</strong>
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
              12 AC Units • <strong className="text-emerald-400">{floor2Groups.filter((g) => g.drive === 'ON').length} Active</strong>
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
              <h3 className="font-bold text-slate-100 text-sm">Ventilation (Lossnay HRUs)</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              4 Energy Recovery Units • <strong className="text-emerald-400">{lossnayGroups.filter((g) => g.drive === 'ON').length} Active</strong>
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 bg-teal-500/10 text-teal-300 border border-teal-500/20 rounded-lg font-medium">
            Interlocked Auto
          </span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        {/* Search Input */}
        <div className="relative w-full sm:w-80">
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
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
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
      </div>

      {/* Zone Cards Grid */}
      {filteredGroups.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredGroups.map((group) => (
            <ZoneCard
              key={group.group_id}
              group={group}
              tempUnit={tempUnit}
              onTogglePower={onTogglePower}
              onOpenDetails={onOpenDetails}
              onResetFilter={onResetFilter}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
          <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <h4 className="text-slate-300 font-bold text-sm">No HVAC zones match your filter</h4>
          <p className="text-slate-500 text-xs mt-1">Try changing your search query or filter category.</p>
        </div>
      )}
    </div>
  );
};
