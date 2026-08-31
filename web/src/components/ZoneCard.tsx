import React from 'react';
import { 
  Power, 
  Flame, 
  Snowflake, 
  Fan, 
  Droplets, 
  RefreshCw, 
  Lock, 
  AlertCircle, 
  Wind,
  Compass
} from 'lucide-react';
import { GroupStatus, OperationMode } from '../types';
import { useAuth } from '../AuthContext';

interface ZoneCardProps {
  group: GroupStatus;
  tempUnit: 'F' | 'C';
  onTogglePower: (group: GroupStatus) => void;
  onOpenDetails: (group: GroupStatus) => void;
  onResetFilter: (groupId: number) => void;
}

export const ZoneCard: React.FC<ZoneCardProps> = ({
  group,
  tempUnit,
  onTogglePower,
  onOpenDetails,
  onResetFilter,
}) => {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const isRunning = group.drive === 'ON';

  // Mode badge styling
  const getModeInfo = (mode: OperationMode) => {
    switch (mode) {
      case 'COOL':
      case 'AUTOCOOL':
      case 'COOLING':
        return { label: 'Cooling', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', icon: Snowflake };
      case 'HEAT':
      case 'AUTOHEAT':
      case 'HEATING':
        return { label: 'Heating', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', icon: Flame };
      case 'AUTO':
      case 'LC_AUTO':
        return { label: 'Auto', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: RefreshCw };
      case 'DRY':
        return { label: 'Dry', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', icon: Droplets };
      case 'FAN':
      case 'VENTILATE':
        return { label: 'Fan Only', color: 'text-teal-400 bg-teal-500/10 border-teal-500/30', icon: Fan };
      case 'HEATRECOVERY':
        return { label: 'Heat Recovery', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30', icon: Wind };
      case 'BYPASS':
        return { label: 'Bypass', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30', icon: Wind };
      default:
        return { label: mode, color: 'text-slate-400 bg-slate-500/10 border-slate-500/30', icon: RefreshCw };
    }
  };

  const modeInfo = getModeInfo(group.mode);
  const ModeIcon = modeInfo.icon;

  const currentTemp = tempUnit === 'F' ? group.inlet_temp_f : group.inlet_temp_c;
  const targetTemp = tempUnit === 'F' ? group.set_temp_f : group.set_temp_c;

  return (
    <div
      className={`relative rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col justify-between ${
        isRunning
          ? 'bg-slate-900/90 border-slate-700/80 shadow-lg shadow-black/20 hover:border-slate-600'
          : 'bg-slate-900/40 border-slate-800/60 opacity-85 hover:opacity-100 hover:border-slate-700'
      }`}
    >
      {/* Top Section */}
      <div className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-slate-100 leading-tight truncate">
                {group.name}
              </h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Gr.{group.group_id} / M{group.address}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {group.model === 'LC' ? 'LOSSNAY Ventilator' : 'Indoor Fan Coil Unit'}
            </p>
          </div>

          {/* Quick Power Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isViewer) onTogglePower(group);
            }}
            disabled={isViewer}
            className={`p-2.5 rounded-xl border transition ${
              isViewer
                ? 'bg-slate-800/50 text-slate-600 border-slate-800 cursor-not-allowed'
                : isRunning
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30 shadow-sm shadow-emerald-950'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700'
            }`}
            title={isViewer ? 'Power control disabled (Viewer mode)' : isRunning ? 'Turn Unit OFF' : 'Turn Unit ON'}
          >
            <Power className="w-4 h-4" />
          </button>
        </div>

        {/* Status Badge & Locks */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${modeInfo.color}`}>
            <ModeIcon className="w-3 h-3" />
            <span>{isRunning ? modeInfo.label : 'Off'}</span>
          </div>

          {group.remote_lock === 'PROHIBIT' && (
            <div className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20" title="Wall remote controller is locked">
              <Lock className="w-2.5 h-2.5" />
              <span>Locked</span>
            </div>
          )}

          {group.schedule_enabled && (
            <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
              Schedule
            </span>
          )}
        </div>

        {/* Temperature Readout */}
        <div className="grid grid-cols-2 gap-3 bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 mb-3">
          <div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium block">Room Temp</span>
            <div className="text-2xl font-bold text-slate-100 tracking-tight">
              {currentTemp !== undefined && currentTemp !== null ? (
                <>
                  {currentTemp}
                  <span className="text-sm font-normal text-slate-400 ml-0.5">°{tempUnit}</span>
                </>
              ) : (
                '--'
              )}
            </div>
          </div>

          <div className="text-right border-l border-slate-800/80 pl-3">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium block">Target</span>
            <div className={`text-2xl font-bold tracking-tight ${isRunning ? 'text-blue-400' : 'text-slate-500'}`}>
              {targetTemp !== undefined && targetTemp !== null && isRunning ? (
                <>
                  {targetTemp}
                  <span className="text-sm font-normal text-slate-400 ml-0.5">°{tempUnit}</span>
                </>
              ) : (
                '--'
              )}
            </div>
          </div>
        </div>

        {/* Fan & Louver Indicators */}
        <div className="flex items-center justify-between text-xs text-slate-400 py-1">
          <div className="flex items-center gap-1.5">
            <Fan className="w-3.5 h-3.5 text-slate-400" />
            <span>Fan: <strong className="text-slate-200">{group.fan_speed}</strong></span>
          </div>

          <div className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-slate-400" />
            <span>Vane: <strong className="text-slate-200">{group.air_direction}</strong></span>
          </div>
        </div>
      </div>

      {/* Filter Warning Banner */}
      {group.filter_dirty && (
        <div className="bg-amber-500/10 border-t border-amber-500/30 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span>Filter Needs Cleaning</span>
          </div>
          {!isViewer && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResetFilter(group.group_id);
              }}
              className="text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-2 py-0.5 rounded border border-amber-500/40 transition"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Bottom Action Footer */}
      <div className="p-3 pt-2 bg-slate-900/80 border-t border-slate-800/80">
        <button
          onClick={() => onOpenDetails(group)}
          className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition text-center"
        >
          {isViewer ? 'View Details & Status' : 'Adjust Settings & Details'}
        </button>
      </div>
    </div>
  );
};
