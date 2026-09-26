import React, { useState, useMemo } from 'react';
import { Search, RefreshCw, ArrowRight } from 'lucide-react';
import { GroupStatus, ScheduleProgram } from '../types';
import { getRoomDisplayName } from '../utils/scheduleHelpers';

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

interface WeekMatrixViewProps {
  groups: GroupStatus[];
  programs: ScheduleProgram[];
  zoneAssignments: Record<number, number[]>;
  weeklyPatterns: Record<number, Record<number, any[]>>;
  tempUnit: 'F' | 'C';
  onSelectSchedule: (program: ScheduleProgram) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export const WeekMatrixView: React.FC<WeekMatrixViewProps> = ({
  groups,
  programs,
  zoneAssignments,
  weeklyPatterns,
  tempUnit,
  onSelectSchedule,
  onRefresh,
  loading = false,
}) => {
  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'floor1' | 'floor2' | 'ventilation'>('all');

  const programMap = useMemo(() => new Map(programs.map(p => [p.id, p])), [programs]);

  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      // 1. Floor / Equipment filter
      if (matrixFilter === 'floor1' && g.floor !== 1) return false;
      if (matrixFilter === 'floor2' && g.floor !== 2) return false;
      if (matrixFilter === 'ventilation' && g.model !== 'LC') return false;

      // 2. Search query
      if (matrixSearch.trim()) {
        const q = matrixSearch.toLowerCase();
        const nameMatch = (g.name || '').toLowerCase().includes(q);
        const roomMatch = (g.room_name || '').toLowerCase().includes(q);
        const idMatch = String(g.group_id).includes(q);
        return nameMatch || roomMatch || idMatch;
      }
      return true;
    });
  }, [groups, matrixFilter, matrixSearch]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
      {/* Search & Floor Filters Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
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
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          Refresh Matrix
        </button>
      </div>

      {/* Matrix Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
              <th className="py-3 px-4 font-semibold w-48">Zone / Space</th>
              <th className="py-3 px-3 font-semibold min-w-[160px]">Active Schedules</th>
              {DAYS_OF_WEEK.map((d) => (
                <th key={d.id} className={`py-3 px-3 font-semibold text-center ${d.highlight ? 'text-blue-400' : ''}`}>
                  {d.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {filteredGroups.map((g) => {
              const assignedPids = zoneAssignments[g.group_id] || [];
              const assignedProgsList = assignedPids.map(id => programMap.get(id)).filter(Boolean) as ScheduleProgram[];

              return (
                <tr key={g.group_id} className="hover:bg-slate-800/30 transition">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-200">
                      {getRoomDisplayName(g)}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Zone {g.group_id} • {g.model === 'LC' ? 'Lossnay HRU' : `Floor ${g.floor || 1}`}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    {assignedProgsList.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {assignedProgsList.map((ap) => {
                          const colorConfig = COLOR_CLASSES[ap.color] || COLOR_CLASSES.blue;
                          return (
                            <button
                              key={ap.id}
                              onClick={() => onSelectSchedule(ap)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition hover:opacity-90 cursor-pointer ${colorConfig.badge}`}
                              title={`Click to edit "${ap.name}"`}
                            >
                              <span>{ap.name}</span>
                              <ArrowRight className="w-2.5 h-2.5 opacity-75" />
                            </button>
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
                    if (assignedProgsList.length === 0) {
                      return (
                        <td key={d.id} className="py-3 px-3 text-center">
                          <span className="text-slate-600 font-mono">—</span>
                        </td>
                      );
                    }

                    const dayEvents = weeklyPatterns[g.group_id]?.[d.id] || weeklyPatterns[g.group_id]?.[String(d.id) as any] || [];
                    const onEvent = dayEvents.find((e) => e.drive !== 'OFF');
                    const offEvent = dayEvents.find((e) => e.drive === 'OFF');

                    // Find which program is running on this day for this zone
                    const runningProg = assignedProgsList.find(p => {
                      const meta = p.metadata_json || {};
                      if (meta.days && Array.isArray(meta.days)) {
                        return meta.days.includes(d.id);
                      }
                      const pat = p.weekly_pattern || {};
                      const pEvents = pat[d.id] || pat[String(d.id) as any] || [];
                      return pEvents.length > 0;
                    });

                    const progColor = runningProg ? COLOR_CLASSES[runningProg.color] || COLOR_CLASSES.blue : null;

                    const tempDisplay = onEvent ? (
                      tempUnit === 'F'
                        ? (onEvent.set_temp_f ? `${onEvent.set_temp_f}°F` : (onEvent.set_temp_c ? `${Math.round((onEvent.set_temp_c * 9/5) + 32)}°F` : 'ON'))
                        : (onEvent.set_temp_c ? `${onEvent.set_temp_c}°C` : (onEvent.set_temp_f ? `${Math.round(((onEvent.set_temp_f - 32) * 5/9) * 2)/2}°C` : 'ON'))
                    ) : null;

                    return (
                      <td
                        key={d.id}
                        onClick={() => {
                          if (runningProg) {
                            onSelectSchedule(runningProg);
                          }
                        }}
                        className={`py-3 px-3 text-center transition ${runningProg ? 'cursor-pointer hover:bg-blue-600/10' : ''}`}
                        title={runningProg ? `Click to edit "${runningProg.name}"` : undefined}
                      >
                        {dayEvents.length > 0 ? (
                          <div className={`inline-block bg-slate-950 px-2 py-1 rounded border ${progColor ? progColor.border : 'border-slate-800'} text-[11px] font-mono`}>
                            <span className="text-emerald-400 font-bold">
                              {onEvent ? onEvent.time_str : 'ON'}
                            </span>
                            {offEvent && (
                              <span className="text-slate-500"> → {offEvent.time_str}</span>
                            )}
                            {tempDisplay && (
                              <div className="text-[10px] text-slate-400">
                                {tempDisplay}
                              </div>
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
  );
};
