import React from 'react';
import { 
  Building2, 
  Power, 
  Sun, 
  Briefcase, 
  Radio, 
  Layers,
  Wind,
  Calendar,
  Settings,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  Eye
} from 'lucide-react';
import { SystemInfo } from '../types';
import { useAuth } from '../AuthContext';

interface HeaderProps {
  systemInfo: SystemInfo | null;
  wsConnected: boolean;
  activeTab: 'dashboard' | 'ventilation' | 'schedules' | 'admin';
  setActiveTab: (tab: 'dashboard' | 'ventilation' | 'schedules' | 'admin') => void;
  tempUnit: 'F' | 'C';
  setTempUnit: (u: 'F' | 'C') => void;
  onApplyPreset: (preset: 'sunday' | 'all_off' | 'office' | 'night') => void;
  runningCount: number;
  dirtyFilterCount: number;
  alarmCount: number;
  loadingPreset: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  systemInfo,
  wsConnected,
  activeTab,
  setActiveTab,
  tempUnit,
  setTempUnit,
  onApplyPreset,
  runningCount,
  dirtyFilterCount,
  alarmCount,
  loadingPreset,
}) => {
  const { user, logout } = useAuth();
  const isViewer = user?.role === 'viewer';
  const isAdmin = user?.role === 'admin';

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      {/* Top Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Brand & System Title */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                {systemInfo?.system_name || 'Example Facility'}
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                {systemInfo?.model || 'GB-50ADA-A'} v{systemInfo?.version || '2.80'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Centralized HVAC Management • {runningCount} Active Zones
            </p>
          </div>
        </div>

        {/* Global Quick Action Scenes */}
        <div className="flex items-center flex-wrap gap-2">
          {!isViewer && (
            <>
              <button
                onClick={() => onApplyPreset('sunday')}
                disabled={loadingPreset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30 text-xs font-semibold transition disabled:opacity-50"
                title="Turn on all AC units to 70°F and Lossnays to High for Sunday Services"
              >
                <Sun className="w-3.5 h-3.5 text-emerald-400" />
                Sunday Service (70°)
              </button>

              <button
                onClick={() => onApplyPreset('office')}
                disabled={loadingPreset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/40 hover:bg-blue-600/30 text-xs font-semibold transition disabled:opacity-50"
                title="Turn on Floor 1 office units (70°F), all other zones OFF"
              >
                <Briefcase className="w-3.5 h-3.5 text-blue-400" />
                Weekday Office
              </button>

              <button
                onClick={() => onApplyPreset('all_off')}
                disabled={loadingPreset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30 text-xs font-semibold transition disabled:opacity-50"
                title="Turn OFF all church HVAC & ventilation units"
              >
                <Power className="w-3.5 h-3.5 text-rose-400" />
                All Off
              </button>
            </>
          )}

          {/* Unit Toggle */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-xs font-medium ml-2">
            <button
              onClick={() => setTempUnit('F')}
              className={`px-2.5 py-1 rounded-md transition ${
                tempUnit === 'F' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              °F
            </button>
            <button
              onClick={() => setTempUnit('C')}
              className={`px-2.5 py-1 rounded-md transition ${
                tempUnit === 'C' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              °C
            </button>
          </div>

          {/* WebSocket Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              wsConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
            }`}
          >
            <Radio className="w-3 h-3" />
            <span>{wsConnected ? 'Live' : 'Connecting'}</span>
          </div>

          {/* Logged In User Profile & Sign Out */}
          {user && (
            <div className="flex items-center gap-2 pl-3 ml-2 border-l border-slate-800">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200">
                {isAdmin ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                ) : isViewer ? (
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span className="font-bold text-slate-100">{user.display_name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-900 text-slate-400 uppercase font-mono tracking-wider">
                  {user.role}
                </span>
              </div>

              <button
                onClick={logout}
                title="Sign out of church HVAC gateway"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg border border-transparent hover:border-rose-500/20 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 border-t border-slate-800/80">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition ${
            activeTab === 'dashboard'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Layers className="w-4 h-4" />
          Zone Dashboard
        </button>

        <button
          onClick={() => setActiveTab('ventilation')}
          className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition ${
            activeTab === 'ventilation'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Wind className="w-4 h-4" />
          Fresh Air Ventilation (LOSSNAY)
        </button>

        <button
          onClick={() => setActiveTab('schedules')}
          className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition ${
            activeTab === 'schedules'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Schedules
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition ${
              activeTab === 'admin'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Settings className="w-4 h-4" />
            Admin & Diagnostics
            {dirtyFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-xs bg-amber-500/20 text-amber-300 font-mono">
                {dirtyFilterCount} Filters
              </span>
            )}
            {alarmCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-xs bg-rose-500/20 text-rose-300 font-mono animate-pulse">
                {alarmCount} Alarms
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  );
};
