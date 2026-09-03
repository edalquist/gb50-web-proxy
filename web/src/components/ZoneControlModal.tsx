import React, { useState, useEffect } from 'react';
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
  Edit2,
  Check,
  RotateCcw
} from 'lucide-react';
import { GroupStatus, DriveState, OperationMode, FanSpeed, AirDirection, GroupControlRequest } from '../types';
import { useAuth } from '../AuthContext';

interface ZoneControlModalProps {
  group: GroupStatus | null;
  tempUnit: 'F' | 'C';
  onClose: () => void;
  onSave: (groupId: number, request: GroupControlRequest) => Promise<void>;
  onRename: (groupId: number, newName: string) => Promise<void>;
  onResetFilter: (groupId: number) => Promise<void>;
}

export const ZoneControlModal: React.FC<ZoneControlModalProps> = ({
  group,
  tempUnit,
  onClose,
  onSave,
  onRename,
  onResetFilter,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const isAdmin = user?.role === 'admin';
  if (!group) return null;

  const [drive, setDrive] = useState<DriveState>(group.drive);
  const [mode, setMode] = useState<OperationMode>(group.mode);
  const [setTempF, setSetTempF] = useState<number>(group.set_temp_f || 70.0);
  const [setTempC, setSetTempC] = useState<number>(group.set_temp_c || 21.0);
  const [fanSpeed, setFanSpeed] = useState<FanSpeed>(group.fan_speed);
  const [airDir, setAirDir] = useState<AirDirection>(group.air_direction);
  const [remoteLock, setRemoteLock] = useState<'PERMIT' | 'PROHIBIT'>(group.remote_lock);
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.name);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDrive(group.drive);
    setMode(group.mode);
    setSetTempF(group.set_temp_f || 70.0);
    setSetTempC(group.set_temp_c || 21.0);
    setFanSpeed(group.fan_speed);
    setAirDir(group.air_direction);
    setRemoteLock(group.remote_lock);
    setNameInput(group.name);
  }, [group]);

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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(group.group_id, {
        drive,
        mode,
        set_temp_f: tempUnit === 'F' ? setTempF : undefined,
        set_temp_c: tempUnit === 'C' ? setTempC : undefined,
        fan_speed: fanSpeed,
        air_direction: airDir,
        remote_lock: remoteLock,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    await onRename(group.group_id, nameInput.trim());
    setIsEditingName(false);
  };

  const isLossnay = group.model === 'LC';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex-1 mr-4">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={20}
                  className="bg-slate-800 border border-blue-500 rounded-lg px-3 py-1 text-sm font-bold text-slate-100 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition"
                  title="Save Name"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100">{group.name}</h2>
                {isAdmin && (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-1 text-slate-400 hover:text-blue-400 transition"
                    title="Rename Zone"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Group {group.group_id} • Address {group.address}
                </span>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-0.5">
              Room Temperature:{' '}
              <strong className="text-slate-200">
                {tempUnit === 'F' ? group.inlet_temp_f : group.inlet_temp_c}°{tempUnit}
              </strong>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Viewer Notice */}
          {isViewer && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 font-semibold flex items-center justify-between">
              <span>Viewer (Read-Only) Mode: Control adjustments and setpoint modifications are disabled.</span>
            </div>
          )}

          {/* Power Drive Toggle */}
          <div className="flex items-center justify-between bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div>
              <span className="font-bold text-sm text-slate-200 block">Unit Power</span>
              <span className="text-xs text-slate-400">
                {drive === 'ON' ? 'Running' : 'Turned Off'}
              </span>
            </div>
            <button
              onClick={() => !isViewer && setDrive(drive === 'ON' ? 'OFF' : 'ON')}
              disabled={isViewer}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition ${
                isViewer
                  ? 'bg-slate-800/50 text-slate-600 border border-slate-800 cursor-not-allowed'
                  : drive === 'ON'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950 hover:bg-emerald-500'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
              }`}
              title={isViewer ? 'Power control disabled (Viewer mode)' : undefined}
            >
              <Power className="w-4 h-4" />
              {drive === 'ON' ? 'POWER ON' : 'POWER OFF'}
            </button>
          </div>

          {/* Temperature Target Dial */}
          {!isLossnay && (
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-400 block mb-3">
                Target Setpoint Temperature
              </span>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => !isViewer && adjustTemp(-1)}
                  disabled={isViewer || drive !== 'ON'}
                  className="p-3 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isViewer ? 'Disabled in Viewer mode' : 'Decrease Temperature'}
                >
                  <Minus className="w-5 h-5" />
                </button>

                <div className="text-center">
                  <div className="text-4xl font-extrabold text-blue-400 tracking-tight">
                    {tempUnit === 'F' ? setTempF : setTempC}
                    <span className="text-lg font-normal text-slate-400 ml-1">°{tempUnit}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {tempUnit === 'F' ? `${setTempC}°C` : `${setTempF}°F`} equivalent
                  </span>
                </div>

                <button
                  onClick={() => !isViewer && adjustTemp(1)}
                  disabled={isViewer || drive !== 'ON'}
                  className="p-3 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isViewer ? 'Disabled in Viewer mode' : 'Increase Temperature'}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* Operating Mode Buttons */}
          <div>
            <span className="font-bold text-xs uppercase tracking-wider text-slate-400 block mb-2">
              Operating Mode
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {isLossnay ? (
                <>
                  {[
                    { val: 'LC_AUTO', label: 'Auto', icon: RefreshCw },
                    { val: 'HEATRECOVERY', label: 'Recovery', icon: Wind },
                    { val: 'BYPASS', label: 'Bypass', icon: Wind },
                  ].map(({ val, label, icon: Icon }) => (
                    <button
                      key={val}
                      onClick={() => !isViewer && setMode(val as OperationMode)}
                      disabled={isViewer}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition ${
                        isViewer
                          ? mode === val
                            ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                          : mode === val
                          ? 'bg-blue-600/30 text-blue-300 border-blue-500 shadow-md'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {[
                    { val: 'AUTO', label: 'Auto', icon: RefreshCw },
                    { val: 'COOL', label: 'Cool', icon: Snowflake },
                    { val: 'HEAT', label: 'Heat', icon: Flame },
                    { val: 'FAN', label: 'Fan', icon: Fan },
                    { val: 'DRY', label: 'Dry', icon: Droplets },
                  ].map(({ val, label, icon: Icon }) => (
                    <button
                      key={val}
                      onClick={() => !isViewer && setMode(val as OperationMode)}
                      disabled={isViewer}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition ${
                        isViewer
                          ? mode === val
                            ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                          : mode === val
                          ? 'bg-blue-600/30 text-blue-300 border-blue-500 shadow-md'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Fan Speeds */}
          <div>
            <span className="font-bold text-xs uppercase tracking-wider text-slate-400 block mb-2">
              Blower Fan Speed
            </span>
            <div className="grid grid-cols-5 gap-2">
              {[
                { val: 'AUTO', label: 'Auto' },
                { val: 'LOW', label: 'Low (1)' },
                { val: 'MID2', label: 'Mid (2)' },
                { val: 'MID1', label: 'Mid (3)' },
                { val: 'HIGH', label: 'High (4)' },
              ].map(({ val, label }) => (
                <button
                  key={val}
                  onClick={() => !isViewer && setFanSpeed(val as FanSpeed)}
                  disabled={isViewer}
                  className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                    isViewer
                      ? fanSpeed === val
                        ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                        : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                      : fanSpeed === val
                      ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500 shadow-md'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Louver / Air Direction */}
          {!isLossnay && (
            <div>
              <span className="font-bold text-xs uppercase tracking-wider text-slate-400 block mb-2">
                Air Louver Vane Direction
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { val: 'AUTO', label: 'Auto' },
                  { val: 'HORIZONTAL', label: 'Horiz' },
                  { val: 'MID1', label: 'Mid 1' },
                  { val: 'MID2', label: 'Mid 2' },
                  { val: 'VERTICAL', label: 'Down' },
                  { val: 'SWING', label: 'Swing' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => !isViewer && setAirDir(val as AirDirection)}
                    disabled={isViewer}
                    className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                      isViewer
                        ? airDir === val
                          ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                          : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                        : airDir === val
                        ? 'bg-purple-600/30 text-purple-300 border-purple-500 shadow-md'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Remote Controller Lockout & Filter Reset */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <button
              onClick={() => !isViewer && setRemoteLock(remoteLock === 'PROHIBIT' ? 'PERMIT' : 'PROHIBIT')}
              disabled={isViewer}
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition ${
                isViewer
                  ? 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                  : remoteLock === 'PROHIBIT'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              }`}
            >
              {remoteLock === 'PROHIBIT' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              {remoteLock === 'PROHIBIT' ? 'Wall Remote Locked' : 'Wall Remote Permitted'}
            </button>

            <button
              onClick={() => !isViewer && onResetFilter(group.group_id)}
              disabled={isViewer}
              className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition ${
                isViewer
                  ? 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
              Reset Air Filter Sign
            </button>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
          {isViewer ? (
            <span className="text-xs text-amber-400 font-medium">
              Read-Only Viewer Mode (Controls Disabled)
            </span>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition"
            >
              Close
            </button>
            {!isViewer && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-lg shadow-blue-900 transition disabled:opacity-50"
              >
                {isSaving ? 'Applying...' : 'Apply Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
