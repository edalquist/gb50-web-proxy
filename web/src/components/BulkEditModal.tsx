import React, { useState } from 'react';
import { 
  X, 
  Power, 
  Flame, 
  Snowflake, 
  Fan, 
  Droplets, 
  RefreshCw, 
  Lock, 
  Unlock, 
  Wind,
  Plus, 
  Minus,
  Check,
  Sliders,
  Layers,
  AlertCircle
} from 'lucide-react';
import { 
  GroupStatus, 
  DriveState, 
  OperationMode, 
  FanSpeed, 
  AirDirection, 
  GroupControlRequest 
} from '../types';
import { useAuth } from '../AuthContext';

interface BulkEditModalProps {
  selectedGroups: GroupStatus[];
  tempUnit: 'F' | 'C';
  onClose: () => void;
  onApply: (updates: Record<number, GroupControlRequest>) => Promise<void>;
  onResetFilters?: (groupIds: number[]) => Promise<void>;
}

export const BulkEditModal: React.FC<BulkEditModalProps> = ({
  selectedGroups,
  tempUnit,
  onClose,
  onApply,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';

  if (selectedGroups.length === 0) return null;

  const isLossnay = selectedGroups[0]?.model === 'LC';
  const groupCount = selectedGroups.length;

  // Track which properties are actively being changed
  const [changeDrive, setChangeDrive] = useState(false);
  const [drive, setDrive] = useState<DriveState>('ON');

  const [changeMode, setChangeMode] = useState(false);
  const [mode, setMode] = useState<OperationMode>(isLossnay ? 'LC_AUTO' : 'AUTO');

  const [changeTemp, setChangeTemp] = useState(false);
  const [setTempF, setSetTempF] = useState<number>(72.0);
  const [setTempC, setSetTempC] = useState<number>(22.0);

  const [changeFan, setChangeFan] = useState(false);
  const [fanSpeed, setFanSpeed] = useState<FanSpeed>(isLossnay ? 'LOW' : 'AUTO');

  const [changeAirDir, setChangeAirDir] = useState(false);
  const [airDir, setAirDir] = useState<AirDirection>('AUTO');

  const [changeRemoteLock, setChangeRemoteLock] = useState(false);
  const [remoteLock, setRemoteLock] = useState<'PERMIT' | 'PROHIBIT'>('PERMIT');

  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const adjustTemp = (delta: number) => {
    if (tempUnit === 'F') {
      const nextF = Math.min(86, Math.max(63, Math.round((setTempF + delta) * 2) / 2));
      setSetTempF(nextF);
      setSetTempC(Math.round(((nextF - 32) * 5 / 9) * 2) / 2);
    } else {
      const nextC = Math.min(30, Math.max(17, Math.round((setTempC + delta * 0.5) * 2) / 2));
      setSetTempC(nextC);
      setSetTempF(Math.round(((nextC * 9 / 5) + 32) * 10) / 10);
    }
  };

  const hasAnyChange = changeDrive || changeMode || (!isLossnay && changeTemp) || changeFan || (!isLossnay && changeAirDir) || changeRemoteLock;

  const handleApply = async () => {
    if (!hasAnyChange) {
      onClose();
      return;
    }

    setIsApplying(true);
    setErrorMsg(null);
    try {
      const batch: Record<number, GroupControlRequest> = {};
      for (const group of selectedGroups) {
        const req: GroupControlRequest = {};
        if (changeDrive) req.drive = drive;
        if (changeMode) req.mode = mode;
        if (!isLossnay && changeTemp) {
          if (tempUnit === 'F') req.set_temp_f = setTempF;
          else req.set_temp_c = setTempC;
        }
        if (changeFan) req.fan_speed = fanSpeed;
        if (!isLossnay && changeAirDir) req.air_direction = airDir;
        if (changeRemoteLock) req.remote_lock = remoteLock;

        batch[group.group_id] = req;
      }

      await onApply(batch);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to apply batch changes');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100">Bulk Edit Zones</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-600/20 text-blue-300 border border-blue-500/30">
                  {groupCount} {isLossnay ? 'Ventilators' : 'Indoor Units'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Apply shared settings across all {groupCount} selected {isLossnay ? 'LOSSNAY' : 'A/C'} zones simultaneously.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {isViewer && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Viewer mode: Bulk modifications are disabled.</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Selected Groups Chips Preview */}
          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="font-semibold flex items-center gap-1.5 text-slate-300">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                Target Zones ({groupCount})
              </span>
              <span>Model: {isLossnay ? 'LC (LOSSNAY)' : 'IC (Indoor Unit)'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {selectedGroups.map((g) => (
                <span
                  key={g.group_id}
                  className="px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700"
                >
                  Gr.{g.group_id} {g.name}
                </span>
              ))}
            </div>
          </div>

          {/* Power Drive Section */}
          <div className={`p-4 rounded-xl border transition ${changeDrive ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={changeDrive}
                  onChange={(e) => setChangeDrive(e.target.checked)}
                  disabled={isViewer}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                Change Power State
              </label>
              {changeDrive && (
                <span className="text-xs text-blue-400 font-semibold">Will apply</span>
              )}
            </div>

            {changeDrive && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setDrive('ON')}
                  disabled={isViewer}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition border ${
                    drive === 'ON'
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Power className="w-4 h-4" />
                  Turn Power ON
                </button>
                <button
                  type="button"
                  onClick={() => setDrive('OFF')}
                  disabled={isViewer}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition border ${
                    drive === 'OFF'
                      ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-950'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Power className="w-4 h-4" />
                  Turn Power OFF
                </button>
              </div>
            )}
          </div>

          {/* Target Temperature Section (Indoor AC Only) */}
          {!isLossnay && (
            <div className={`p-4 rounded-xl border transition ${changeTemp ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={changeTemp}
                    onChange={(e) => setChangeTemp(e.target.checked)}
                    disabled={isViewer}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  Change Target Temperature Setpoint
                </label>
                {changeTemp && (
                  <span className="text-xs text-blue-400 font-semibold">Will apply</span>
                )}
              </div>

              {changeTemp && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => adjustTemp(-1)}
                    disabled={isViewer}
                    className="p-3 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 active:scale-95 transition"
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <div className="text-center">
                    <div className="text-3xl font-extrabold text-blue-400 tracking-tight">
                      {tempUnit === 'F' ? setTempF : setTempC}
                      <span className="text-base font-normal text-slate-400 ml-1">°{tempUnit}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {tempUnit === 'F' ? `${setTempC}°C` : `${setTempF}°F`} equivalent
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => adjustTemp(1)}
                    disabled={isViewer}
                    className="p-3 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 active:scale-95 transition"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Operating Mode Section */}
          <div className={`p-4 rounded-xl border transition ${changeMode ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={changeMode}
                  onChange={(e) => setChangeMode(e.target.checked)}
                  disabled={isViewer}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                Change Operating Mode
              </label>
              {changeMode && (
                <span className="text-xs text-blue-400 font-semibold">Will apply</span>
              )}
            </div>

            {changeMode && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                {isLossnay ? (
                  <>
                    {[
                      { val: 'LC_AUTO', label: 'Auto', icon: RefreshCw },
                      { val: 'HEATRECOVERY', label: 'Recovery', icon: Wind },
                      { val: 'BYPASS', label: 'Bypass', icon: Wind },
                    ].map(({ val, label, icon: Icon }) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMode(val as OperationMode)}
                        disabled={isViewer}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition ${
                          mode === val
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {[
                      { val: 'AUTO', label: 'Auto', icon: RefreshCw },
                      { val: 'COOL', label: 'Cool', icon: Snowflake },
                      { val: 'HEAT', label: 'Heat', icon: Flame },
                      { val: 'DRY', label: 'Dry', icon: Droplets },
                      { val: 'FAN', label: 'Fan Only', icon: Fan },
                    ].map(({ val, label, icon: Icon }) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMode(val as OperationMode)}
                        disabled={isViewer}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition ${
                          mode === val
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-950'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Fan Speed Section */}
          <div className={`p-4 rounded-xl border transition ${changeFan ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={changeFan}
                  onChange={(e) => setChangeFan(e.target.checked)}
                  disabled={isViewer}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                Change Fan Speed
              </label>
              {changeFan && (
                <span className="text-xs text-blue-400 font-semibold">Will apply</span>
              )}
            </div>

            {changeFan && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                {isLossnay ? (
                  <>
                    {[
                      { val: 'LOW', label: 'Low' },
                      { val: 'HIGH', label: 'High' },
                    ].map(({ val, label }) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFanSpeed(val as FanSpeed)}
                        disabled={isViewer}
                        className={`py-2.5 rounded-xl border text-xs font-semibold transition ${
                          fanSpeed === val
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {[
                      { val: 'AUTO', label: 'Auto' },
                      { val: 'LOW', label: 'Low' },
                      { val: 'MID2', label: 'Mid' },
                      { val: 'HIGH', label: 'High' },
                    ].map(({ val, label }) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFanSpeed(val as FanSpeed)}
                        disabled={isViewer}
                        className={`py-2.5 rounded-xl border text-xs font-semibold transition ${
                          fanSpeed === val
                            ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Vane / Louver Direction (Indoor AC Only) */}
          {!isLossnay && (
            <div className={`p-4 rounded-xl border transition ${changeAirDir ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={changeAirDir}
                    onChange={(e) => setChangeAirDir(e.target.checked)}
                    disabled={isViewer}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  Change Louver / Air Direction
                </label>
                {changeAirDir && (
                  <span className="text-xs text-blue-400 font-semibold">Will apply</span>
                )}
              </div>

              {changeAirDir && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                  {[
                    { val: 'AUTO', label: 'Auto' },
                    { val: 'HORIZONTAL', label: 'Horizontal' },
                    { val: 'MID1', label: 'Mid-High' },
                    { val: 'MID2', label: 'Mid-Low' },
                    { val: 'VERTICAL', label: 'Vertical' },
                    { val: 'SWING', label: 'Swing' },
                  ].map(({ val, label }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAirDir(val as AirDirection)}
                      disabled={isViewer}
                      className={`py-2.5 rounded-xl border text-xs font-semibold transition ${
                        airDir === val
                          ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Wall Remote Lockout Toggle */}
          <div className={`p-4 rounded-xl border transition ${changeRemoteLock ? 'bg-slate-950/80 border-blue-500/40' : 'bg-slate-950/40 border-slate-800/60'}`}>
            <div className="flex items-center justify-between mb-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={changeRemoteLock}
                  onChange={(e) => setChangeRemoteLock(e.target.checked)}
                  disabled={isViewer}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                Change Wall Remote Lockout
              </label>
              {changeRemoteLock && (
                <span className="text-xs text-blue-400 font-semibold">Will apply</span>
              )}
            </div>

            {changeRemoteLock && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRemoteLock('PERMIT')}
                  disabled={isViewer}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition border ${
                    remoteLock === 'PERMIT'
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Unlock className="w-4 h-4" />
                  Permit Wall Remotes (Unlock)
                </button>
                <button
                  type="button"
                  onClick={() => setRemoteLock('PROHIBIT')}
                  disabled={isViewer}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition border ${
                    remoteLock === 'PROHIBIT'
                      ? 'bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-950'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  Lock Wall Remotes (Prohibit)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={isViewer || !hasAnyChange || isApplying}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-950 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            {isApplying ? 'Applying Batch Changes...' : `Apply to ${groupCount} Zones`}
          </button>
        </div>
      </div>
    </div>
  );
};
