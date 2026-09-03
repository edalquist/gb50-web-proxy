import React, { useState } from 'react';
import { 
  X, 
  Copy, 
  Sliders, 
  Flame, 
  Snowflake, 
  AlertTriangle, 
  RefreshCw,
  Plus,
  Minus,
  Sparkles
} from 'lucide-react';
import { SeasonConfig, SeasonCloneRequest, ScheduleProgram } from '../types';

interface SeasonCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  seasons: SeasonConfig[];
  programs: ScheduleProgram[];
  activeSeasonId: number;
  onCloneSeason: (sourceId: number, targetId: number, req: SeasonCloneRequest) => Promise<void>;
}

export const SeasonCloneModal: React.FC<SeasonCloneModalProps> = ({
  isOpen,
  onClose,
  seasons,
  programs,
  activeSeasonId,
  onCloneSeason,
}) => {
  const [sourceSeasonId, setSourceSeasonId] = useState<number>(() => activeSeasonId || 1);
  const [targetSeasonId, setTargetSeasonId] = useState<number>(() => (activeSeasonId === 1 ? 2 : 1));
  const [modeTransform, setModeTransform] = useState<'NONE' | 'COOL_TO_HEAT' | 'HEAT_TO_COOL' | 'INVERT'>('COOL_TO_HEAT');
  const [setpointOffsetF, setSetpointOffsetF] = useState<number>(-2.0);
  const [conflictStrategy, setConflictStrategy] = useState<'REPLACE' | 'APPEND'>('REPLACE');
  const [autoFlash, setAutoFlash] = useState<boolean>(true);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const sourceSeason = seasons.find(s => s.season_id === sourceSeasonId);
  const targetSeason = seasons.find(s => s.season_id === targetSeasonId);

  const sourcePrograms = programs.filter(
    p => (p.season_id === sourceSeasonId || !p.season_id) && (!p.season_scope || !p.season_scope.includes('all'))
  );

  const existingTargetPrograms = programs.filter(
    p => p.season_id === targetSeasonId
  );

  const handleExecuteClone = async () => {
    if (sourceSeasonId === targetSeasonId) {
      setError('Source and target seasons cannot be the same.');
      return;
    }
    setCloning(true);
    setError(null);
    try {
      await onCloneSeason(sourceSeasonId, targetSeasonId, {
        mode_transformation: modeTransform,
        setpoint_offset_f: setpointOffsetF,
        conflict_strategy: conflictStrategy,
        auto_flash_hardware: autoFlash,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to clone seasonal schedules.');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Copy className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Clone Seasonal Schedules
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Duplicate schedule routines from one season to another with automatic temperature offsets and mode conversions.
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1">
          
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-sm">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Season Selector: Source -> Target */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            
            {/* Source Season */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Source Season (Copy From)
              </label>
              <select
                value={sourceSeasonId}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSourceSeasonId(val);
                  if (val === targetSeasonId) {
                    setTargetSeasonId(val === 1 ? 2 : 1);
                  }
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-indigo-500"
              >
                {seasons.map((s) => (
                  <option key={s.season_id} value={s.season_id}>
                    Season {s.season_id}: {s.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400">
                {sourcePrograms.length} routine programs found in this season
              </p>
            </div>

            {/* Target Season */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Target Season (Copy To)
              </label>
              <select
                value={targetSeasonId}
                onChange={(e) => setTargetSeasonId(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-indigo-500"
              >
                {seasons.map((s) => (
                  <option
                    key={s.season_id}
                    value={s.season_id}
                    disabled={s.season_id === sourceSeasonId}
                  >
                    Season {s.season_id}: {s.name} {s.season_id === sourceSeasonId ? '(Source)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400">
                Currently has {existingTargetPrograms.length} existing programs
              </p>
            </div>

          </div>

          {/* Mode Transformation Options */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 text-blue-400" />
              Operating Mode Transformation
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              
              <button
                type="button"
                onClick={() => setModeTransform('COOL_TO_HEAT')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  modeTransform === 'COOL_TO_HEAT'
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <Flame className="w-4 h-4 text-amber-400" />
                  COOL ➔ HEAT (For Winter)
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Converts cooling timers to heating timers for the cold season.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setModeTransform('HEAT_TO_COOL')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  modeTransform === 'HEAT_TO_COOL'
                    ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <Snowflake className="w-4 h-4 text-blue-400" />
                  HEAT ➔ COOL (For Summer)
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Converts heating timers to cooling timers for warm weather.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setModeTransform('NONE')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  modeTransform === 'NONE'
                    ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Keep Original Modes
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Preserves all timer modes as originally programmed.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setModeTransform('INVERT')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  modeTransform === 'INVERT'
                    ? 'bg-purple-500/10 border-purple-500/40 text-purple-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <RefreshCw className="w-4 h-4 text-purple-400" />
                  Invert Modes (COOL ⇄ HEAT)
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Flips cool to heat and heat to cool simultaneously.
                </p>
              </button>

            </div>
          </div>

          {/* Temperature Setpoint Offset */}
          <div className="space-y-3 bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-amber-400" />
                Temperature Setpoint Adjustment Offset
              </label>
              <span className={`text-sm font-bold ${setpointOffsetF > 0 ? 'text-amber-400' : setpointOffsetF < 0 ? 'text-blue-400' : 'text-slate-300'}`}>
                {setpointOffsetF > 0 ? `+${setpointOffsetF}°F` : setpointOffsetF < 0 ? `${setpointOffsetF}°F` : '0°F (No change)'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSetpointOffsetF(prev => Math.max(-10, prev - 1))}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>

              <input
                type="range"
                min="-10"
                max="10"
                step="1"
                value={setpointOffsetF}
                onChange={(e) => setSetpointOffsetF(Number(e.target.value))}
                className="flex-1 accent-indigo-500 cursor-pointer"
              />

              <button
                type="button"
                onClick={() => setSetpointOffsetF(prev => Math.min(10, prev + 1))}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setSetpointOffsetF(0)}
                className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                Reset
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Shift setpoint temperatures across all copied timers (e.g. drop 2°F for winter energy savings).
            </p>
          </div>

          {/* Conflict Resolution & Auto-Flash */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Conflict Handling in Target Season
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  conflictStrategy === 'REPLACE'
                    ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400'
                }`}>
                  <input
                    type="radio"
                    name="conflictStrategy"
                    value="REPLACE"
                    checked={conflictStrategy === 'REPLACE'}
                    onChange={() => setConflictStrategy('REPLACE')}
                    className="mt-0.5 text-rose-500 focus:ring-rose-500"
                  />
                  <div>
                    <div className="font-bold text-xs text-white">Replace Existing Schedules</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Clears existing specific routines in Season {targetSeasonId} before copying.
                    </div>
                  </div>
                </label>

                <label className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  conflictStrategy === 'APPEND'
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-800/40 border-slate-700 text-slate-400'
                }`}>
                  <input
                    type="radio"
                    name="conflictStrategy"
                    value="APPEND"
                    checked={conflictStrategy === 'APPEND'}
                    onChange={() => setConflictStrategy('APPEND')}
                    className="mt-0.5 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div>
                    <div className="font-bold text-xs text-white">Append Alongside Existing</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Adds new routines to Season {targetSeasonId} without deleting existing ones.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Auto Flash Hardware Checkbox */}
            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                checked={autoFlash}
                onChange={(e) => setAutoFlash(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500 w-4 h-4"
              />
              <div>
                <span>Automatically Flash Target Season to Controller Hardware</span>
                <p className="text-[11px] text-slate-400 font-normal mt-0.5">
                  Writes merged patterns for Season {targetSeasonId} directly to GB-50 EEPROM.
                </p>
              </div>
            </label>
          </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Will duplicate <span className="font-bold text-white">{sourcePrograms.length}</span> programs from {sourceSeason?.name || `Season ${sourceSeasonId}`} into {targetSeason?.name || `Season ${targetSeasonId}`}.
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
              onClick={handleExecuteClone}
              disabled={cloning || sourcePrograms.length === 0}
              className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Copy className="w-4 h-4" />
              {cloning ? 'Cloning & Syncing...' : `Clone into Season ${targetSeasonId}`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
