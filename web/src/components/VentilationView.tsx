import React from 'react';
import { Wind, Power, AlertCircle, Fan } from 'lucide-react';
import { GroupStatus, OperationMode, FanSpeed, GroupControlRequest } from '../types';
import { useAuth } from '../AuthContext';

interface VentilationViewProps {
  groups: GroupStatus[];
  onControlGroup: (groupId: number, request: GroupControlRequest) => Promise<void>;
  onResetFilter: (groupId: number) => void;
}

export const VentilationView: React.FC<VentilationViewProps> = ({
  groups,
  onControlGroup,
  onResetFilter,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const lossnayUnits = groups.filter((g) => g.model === 'LC');

  const setLossnayMode = async (groupId: number, mode: OperationMode) => {
    if (isViewer) return;
    await onControlGroup(groupId, { mode });
  };

  const setLossnayFan = async (groupId: number, fan_speed: FanSpeed) => {
    if (isViewer) return;
    await onControlGroup(groupId, { fan_speed });
  };

  const togglePower = async (group: GroupStatus) => {
    if (isViewer) return;
    await onControlGroup(group.group_id, {
      drive: group.drive === 'ON' ? 'OFF' : 'ON',
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Read-Only Notice for Viewers */}
      {isViewer && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-300 font-semibold flex items-center gap-2 shadow">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Viewing fresh air ventilation in Read-Only mode. Power and airflow controls are disabled.</span>
        </div>
      )}

      {/* Educational Banner for Non-Expert Users */}
      <div className="bg-gradient-to-r from-teal-950/40 to-slate-900 border border-teal-500/30 rounded-2xl p-5 flex items-start gap-4 shadow-sm">
        <div className="p-3 bg-teal-500/20 text-teal-300 rounded-xl border border-teal-500/30 flex-shrink-0">
          <Wind className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            LOSSNAY Fresh Air Energy Recovery Ventilators
          </h2>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            Dedicated LOSSNAY energy recovery ventilators (HRUs) bring in fresh outside air
            while recovering heating and cooling energy from the exhaust air. They run interlocked with paired indoor fan coils or can
            be manually set to <strong>Heat Recovery</strong> (energy saving) or <strong>Bypass</strong> (free cooling with cool outdoor air).
          </p>
        </div>
      </div>

      {/* Grid of LOSSNAY Units */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {lossnayUnits.map((unit) => {
          const isRunning = unit.drive === 'ON';
          return (
            <div
              key={unit.group_id}
              className={`rounded-2xl border p-5 space-y-4 transition ${
                isRunning
                  ? 'bg-slate-900 border-teal-500/40 shadow-lg shadow-teal-950/30'
                  : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              {/* Top Bar */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg text-slate-100">{unit.name}</h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-teal-400 border border-slate-700">
                      Group {unit.group_id} • Addr {unit.address}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {unit.floor ? `Floor ${unit.floor}` : ((unit as { floor?: number }).floor ?? 1) === 1 ? 'Floor 1' : 'Floor 2'}
                  </p>
                </div>

                <button
                  onClick={() => togglePower(unit)}
                  disabled={isViewer}
                  className={`p-3 rounded-xl border transition ${
                    isViewer
                      ? 'bg-slate-800/50 text-slate-600 border-slate-800 cursor-not-allowed'
                      : isRunning
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40 hover:bg-teal-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                  title={isViewer ? 'Power control disabled (Viewer mode)' : isRunning ? 'Turn Ventilator OFF' : 'Turn Ventilator ON'}
                >
                  <Power className="w-5 h-5" />
                </button>
              </div>

              {/* Status Row */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                    isRunning
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {isRunning ? `Running (${unit.mode})` : 'Standby / Stopped'}
                </span>
                <span className="text-xs text-slate-400">
                  Speed: <strong className="text-slate-200">{unit.fan_speed}</strong>
                </span>
              </div>

              {/* Mode Selection */}
              <div>
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400 block mb-2">
                  Ventilation Operation Mode
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { mode: 'LC_AUTO' as OperationMode, label: 'Auto (Recommended)' },
                    { mode: 'HEATRECOVERY' as OperationMode, label: 'Heat Recovery' },
                    { mode: 'BYPASS' as OperationMode, label: 'Bypass (Free Cool)' },
                  ].map(({ mode, label }) => (
                    <button
                      key={mode}
                      onClick={() => setLossnayMode(unit.group_id, mode)}
                      disabled={isViewer}
                      className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center ${
                        isViewer
                          ? unit.mode === mode
                            ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                          : unit.mode === mode
                          ? 'bg-teal-600/30 text-teal-200 border-teal-500 shadow-md'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                      title={isViewer ? 'Disabled in Viewer mode' : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fan Speed Selection */}
              <div>
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400 block mb-2">
                  Airflow Speed
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { speed: 'LOW' as FanSpeed, label: 'Low Airflow (Quiet)' },
                    { speed: 'HIGH' as FanSpeed, label: 'High Airflow (Boost)' },
                  ].map(({ speed, label }) => (
                    <button
                      key={speed}
                      onClick={() => setLossnayFan(unit.group_id, speed)}
                      disabled={isViewer}
                      className={`p-2.5 rounded-xl border text-xs font-semibold transition text-center flex items-center justify-center gap-2 ${
                        isViewer
                          ? unit.fan_speed === speed
                            ? 'bg-slate-800 text-slate-300 border-slate-700 cursor-not-allowed'
                            : 'bg-slate-900/40 text-slate-600 border-slate-800/80 cursor-not-allowed'
                          : unit.fan_speed === speed
                          ? 'bg-blue-600/30 text-blue-200 border-blue-500 shadow-md'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                      }`}
                      title={isViewer ? 'Disabled in Viewer mode' : undefined}
                    >
                      <Fan className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter Warning */}
              {unit.filter_dirty && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span>Ventilator Filter Cleaning Alert</span>
                  </div>
                  {!isViewer && (
                    <button
                      onClick={() => onResetFilter(unit.group_id)}
                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg text-xs font-bold border border-amber-500/40 transition"
                    >
                      Reset Filter
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
