import React from 'react';
import { SystemInfo } from '../types';
import { useAuth } from '../AuthContext';

interface HeaderProps {
  systemInfo: SystemInfo | null;
  wsConnected: boolean;
  activeTab: 'dashboard' | 'ventilation' | 'schedules' | 'admin';
  setActiveTab: (tab: 'dashboard' | 'ventilation' | 'schedules' | 'admin') => void;
  tempUnit: 'F' | 'C';
  setTempUnit: (u: 'F' | 'C') => void;
  runningCount: number;
  dirtyFilterCount: number;
  alarmCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  systemInfo,
  wsConnected,
  activeTab,
  setActiveTab,
  tempUnit,
  setTempUnit,
  runningCount,
  dirtyFilterCount,
  alarmCount,
}) => {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <header className="mock-header">
      {/* Brand */}
      <div className="brand">
        <div className="logo">⌂</div>
        <div>
          <strong>{systemInfo?.system_name || 'Facility HVAC'}</strong>
          <small>{runningCount > 0 ? `${runningCount} spaces active` : 'Building comfort'}</small>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Primary">
        <button
          type="button"
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={activeTab === 'schedules' ? 'active' : ''}
          onClick={() => setActiveTab('schedules')}
        >
          Schedules
        </button>
        <button
          type="button"
          className={activeTab === 'ventilation' ? 'active' : ''}
          onClick={() => setActiveTab('ventilation')}
        >
          Fresh Air
        </button>
        {isAdmin && (
          <button
            type="button"
            className={activeTab === 'admin' ? 'active' : ''}
            onClick={() => setActiveTab('admin')}
          >
            Facilities
            {dirtyFilterCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#f0ba5a' }}>
                ({dirtyFilterCount})
              </span>
            )}
            {alarmCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#fa7185' }}>
                ({alarmCount})
              </span>
            )}
          </button>
        )}
      </nav>

      {/* User Controls */}
      <div className="user">
        {/* Unit Toggle */}
        <div style={{ display: 'flex', background: '#0d1628', borderRadius: '8px', border: '1px solid #2b3856', padding: '2px' }}>
          <button
            type="button"
            onClick={() => setTempUnit('F')}
            style={{
              border: 0,
              background: tempUnit === 'F' ? 'var(--blue)' : 'transparent',
              color: tempUnit === 'F' ? '#fff' : 'var(--muted)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: tempUnit === 'F' ? 700 : 500,
              cursor: 'pointer'
            }}
          >
            °F
          </button>
          <button
            type="button"
            onClick={() => setTempUnit('C')}
            style={{
              border: 0,
              background: tempUnit === 'C' ? 'var(--blue)' : 'transparent',
              color: tempUnit === 'C' ? '#fff' : 'var(--muted)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: tempUnit === 'C' ? 700 : 500,
              cursor: 'pointer'
            }}
          >
            °C
          </button>
        </div>

        {/* Live Status */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: wsConnected ? 'var(--green)' : 'var(--amber)', fontSize: '13px' }}>
          ● {wsConnected ? 'Live' : 'Connecting'}
        </span>

        {/* User Badge */}
        <span>{user ? user.display_name || 'Operations Staff' : 'Operations Staff'}</span>

        {/* Logout */}
        {user && (
          <button
            type="button"
            onClick={logout}
            title="Sign out of HVAC management gateway"
            style={{
              background: 'transparent',
              border: '1px solid #33415d',
              color: 'var(--muted)',
              borderRadius: '7px',
              padding: '5px 9px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
};
