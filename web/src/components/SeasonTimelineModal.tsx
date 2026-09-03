import React, { useState } from 'react';
import { 
  X, 
  Calendar, 
  AlertCircle, 
  Sun, 
  Snowflake, 
  Flower2, 
  Leaf, 
  Sparkles, 
  Clock, 
  Layers,
  Save
} from 'lucide-react';
import { SeasonConfig } from '../types';

interface SeasonTimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  seasons: SeasonConfig[];
  onSaveSeasons: (seasons: SeasonConfig[]) => Promise<void>;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; bar: string }> = {
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', bar: 'bg-amber-500' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', bar: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', bar: 'bg-emerald-500' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30', bar: 'bg-rose-500' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', bar: 'bg-purple-500' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', bar: 'bg-cyan-500' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30', bar: 'bg-indigo-500' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/30', bar: 'bg-teal-500' },
};

const SEASON_ICONS = [Sun, Snowflake, Flower2, Leaf, Sparkles];

export const SeasonTimelineModal: React.FC<SeasonTimelineModalProps> = ({
  isOpen,
  onClose,
  seasons,
  onSaveSeasons,
}) => {
  const [editedSeasons, setEditedSeasons] = useState<SeasonConfig[]>(() => {
    // Ensure all 5 seasons are initialized
    const list = [...seasons];
    for (let i = 1; i <= 5; i++) {
      if (!list.some(s => s.season_id === i)) {
        list.push({
          season_id: i,
          name: `Season ${i}`,
          description: '',
          start_month: 0,
          start_day: 0,
          end_month: 0,
          end_day: 0,
          color: ['amber', 'blue', 'emerald', 'rose', 'purple'][i - 1] || 'blue',
          enabled: i <= 2,
        });
      }
    }
    return list.sort((a, b) => a.season_id - b.season_id);
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFieldChange = (seasonId: number, field: keyof SeasonConfig, val: any) => {
    setEditedSeasons(prev =>
      prev.map(s => (s.season_id === seasonId ? { ...s, [field]: val } : s))
    );
  };

  const handleSetPreset = (seasonId: number, presetType: 'full_year' | 'clear' | 'summer' | 'winter') => {
    setEditedSeasons(prev =>
      prev.map(s => {
        if (s.season_id !== seasonId) return s;
        if (presetType === 'full_year') {
          return { ...s, start_month: 1, start_day: 1, end_month: 12, end_day: 31, enabled: true };
        } else if (presetType === 'clear') {
          return { ...s, start_month: 0, start_day: 0, end_month: 0, end_day: 0, enabled: false };
        } else if (presetType === 'summer') {
          return { ...s, name: 'Summer Cooling', start_month: 4, start_day: 1, end_month: 9, end_day: 30, color: 'amber', enabled: true };
        } else if (presetType === 'winter') {
          return { ...s, name: 'Winter Heating', start_month: 10, start_day: 1, end_month: 3, end_day: 31, color: 'blue', enabled: true };
        }
        return s;
      })
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveSeasons(editedSeasons);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save seasonal calendar date spans.');
    } finally {
      setSaving(false);
    }
  };

  // Check which months each season covers for the 12-month visual timeline
  const getMonthCoverage = (season: SeasonConfig, monthIdx: number): boolean => {
    if (!season.enabled || season.start_month === 0 || season.end_month === 0) return false;
    const m = monthIdx + 1;
    if (season.start_month <= season.end_month) {
      return m >= season.start_month && m <= season.end_month;
    } else {
      // Wraps around year-end (e.g. Oct to Mar)
      return m >= season.start_month || m <= season.end_month;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Seasonal Calendar & Date Spans
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure annual date spans for up to 5 global seasons and flash directly to Mitsubishi GB-50 controller memory.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 12-Month Visual Timeline */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                Annual 12-Month Coverage Overview
              </span>
              <span className="text-xs text-slate-400">
                Today: {MONTHS[new Date().getMonth()]} {new Date().getDate()}
              </span>
            </div>

            {/* Months Header */}
            <div className="grid grid-cols-12 gap-1 text-center text-[10px] font-medium text-slate-400 pb-1 border-b border-slate-800/80">
              {MONTHS.map((m, idx) => {
                const isCurrentMonth = new Date().getMonth() === idx;
                return (
                  <div key={m} className={`py-1 rounded ${isCurrentMonth ? 'bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/40' : ''}`}>
                    {m}
                  </div>
                );
              })}
            </div>

            {/* Season Timeline Rows */}
            <div className="space-y-1.5 pt-1">
              {editedSeasons.map((s, sIdx) => {
                const colors = COLOR_MAP[s.color] || COLOR_MAP.blue;
                const Icon = SEASON_ICONS[sIdx] || Sparkles;
                return (
                  <div key={s.season_id} className="grid grid-cols-12 gap-1 items-center">
                    {MONTHS.map((_, mIdx) => {
                      const covered = getMonthCoverage(s, mIdx);
                      return (
                        <div
                          key={mIdx}
                          className={`h-6 rounded flex items-center justify-center transition-all ${
                            covered
                              ? `${colors.bar} text-slate-950 font-bold text-[10px] shadow-sm`
                              : 'bg-slate-900/60 border border-slate-800/40'
                          }`}
                          title={covered ? `${s.name} (${s.start_month}/${s.start_day} - ${s.end_month}/${s.end_day})` : 'Unassigned'}
                        >
                          {covered && mIdx === (s.start_month - 1) && (
                            <Icon className="w-3 h-3 text-slate-950" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800/60 text-xs">
              {editedSeasons.map((s) => {
                const colors = COLOR_MAP[s.color] || COLOR_MAP.blue;
                if (!s.enabled || s.start_month === 0) return null;
                return (
                  <div key={s.season_id} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded ${colors.bar}`} />
                    <span className="text-slate-300 font-medium">{s.name}:</span>
                    <span className="text-slate-400">{MONTHS[s.start_month - 1]} {s.start_day} – {MONTHS[s.end_month - 1]} {s.end_day}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Season Cards */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              Configure Season Slots (1 through 5)
            </h3>

            {editedSeasons.map((season, idx) => {
              const colors = COLOR_MAP[season.color] || COLOR_MAP.blue;
              const Icon = SEASON_ICONS[idx] || Sparkles;

              return (
                <div
                  key={season.season_id}
                  className={`p-4 rounded-xl border transition-all ${
                    season.enabled
                      ? `${colors.bg} ${colors.border}`
                      : 'bg-slate-950/40 border-slate-800/60 opacity-65'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    
                    {/* Left: Slot & Name */}
                    <div className="flex items-center space-x-3 min-w-[240px]">
                      <div className={`p-2.5 rounded-xl border ${colors.border} ${colors.bg} ${colors.text}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Season {season.season_id}
                          </span>
                          {season.is_active_today && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                              ● Active Today
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={season.name}
                          onChange={(e) => handleFieldChange(season.season_id, 'name', e.target.value)}
                          className="mt-1 w-full bg-slate-900/80 border border-slate-700/80 rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-indigo-500"
                          placeholder="Season Name (e.g. Summer Cooling)"
                        />
                      </div>
                    </div>

                    {/* Middle: Date Range Inputs */}
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                      {/* Start Date */}
                      <div className="flex items-center gap-1.5 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 font-medium">Start:</span>
                        <select
                          value={season.start_month}
                          onChange={(e) => handleFieldChange(season.season_id, 'start_month', Number(e.target.value))}
                          disabled={!season.enabled}
                          className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none"
                        >
                          <option value={0}>Unassigned (0)</option>
                          {MONTHS.map((m, mIdx) => (
                            <option key={m} value={mIdx + 1}>{m} ({mIdx + 1})</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={31}
                          value={season.start_day}
                          onChange={(e) => handleFieldChange(season.season_id, 'start_day', Number(e.target.value))}
                          disabled={!season.enabled}
                          className="w-14 bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none"
                          placeholder="Day"
                        />
                      </div>

                      <span className="text-slate-500 font-bold">➔</span>

                      {/* End Date */}
                      <div className="flex items-center gap-1.5 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400 font-medium">End:</span>
                        <select
                          value={season.end_month}
                          onChange={(e) => handleFieldChange(season.season_id, 'end_month', Number(e.target.value))}
                          disabled={!season.enabled}
                          className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none"
                        >
                          <option value={0}>Unassigned (0)</option>
                          {MONTHS.map((m, mIdx) => (
                            <option key={m} value={mIdx + 1}>{m} ({mIdx + 1})</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={31}
                          value={season.end_day}
                          onChange={(e) => handleFieldChange(season.season_id, 'end_day', Number(e.target.value))}
                          disabled={!season.enabled}
                          className="w-14 bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1 text-xs text-center focus:outline-none"
                          placeholder="Day"
                        />
                      </div>
                    </div>

                    {/* Right: Color & Enabled Toggle */}
                    <div className="flex items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800">
                      
                      {/* Color dots */}
                      <div className="flex items-center gap-1 bg-slate-900/60 p-1 rounded-lg border border-slate-800">
                        {['amber', 'blue', 'emerald', 'rose', 'purple'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleFieldChange(season.season_id, 'color', c)}
                            className={`w-4 h-4 rounded-full ${COLOR_MAP[c].bar} transition-transform ${
                              season.color === c ? 'scale-125 ring-2 ring-white/60' : 'opacity-60 hover:opacity-100'
                            }`}
                          />
                        ))}
                      </div>

                      {/* Enable Switch */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-300">
                        <input
                          type="checkbox"
                          checked={season.enabled}
                          onChange={(e) => handleFieldChange(season.season_id, 'enabled', e.target.checked)}
                          className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 w-4 h-4"
                        />
                        <span>Enabled</span>
                      </label>

                      {/* Presets dropdown */}
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleSetPreset(season.season_id, 'full_year')}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          title="Set to All Year (Jan 1 to Dec 31)"
                        >
                          All Year
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetPreset(season.season_id, 'clear')}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                          title="Reset to 0/0 (Unassigned)"
                        >
                          Clear
                        </button>
                      </div>

                    </div>

                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Saving will flash date spans to controller memory (<code className="text-amber-400">WSeasonList</code>).
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Flashing Controller...' : 'Save & Flash to Controller'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
