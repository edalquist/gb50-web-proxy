import React, { useState, useEffect, useCallback } from 'react';
import { 
  fetchSystemInfo, 
  fetchGroups, 
  controlGroup, 
  batchControl, 
  applyPreset, 
  resetFilter, 
  renameGroup, 
  subscribeToWebSocket 
} from './api';
import { GroupStatus, SystemInfo, GroupControlRequest } from './types';
import { useAppRouter, MainTab } from './router';
import { useAuth } from './AuthContext';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { VentilationView } from './components/VentilationView';
import { ScheduleView } from './components/ScheduleView';
import { AdminPanel } from './components/AdminPanel';
import { ZoneControlModal } from './components/ZoneControlModal';
import { LoginView } from './components/LoginView';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { route, goTo } = useAppRouter();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [groups, setGroups] = useState<GroupStatus[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [tempUnit, setTempUnit] = useState<'F' | 'C'>('F');
  const [selectedGroup, setSelectedGroup] = useState<GroupStatus | null>(null);

  // Initial Load
  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [sys, grps] = await Promise.all([fetchSystemInfo(), fetchGroups()]);
      setSystemInfo(sys);
      setGroups(grps);
    } catch (err) {
      console.error('Failed to load initial controller data:', err);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();

      // Subscribe to live WebSocket updates
      const unsubscribe = subscribeToWebSocket(
        (updatedGroups) => {
          setGroups((prev) => {
            const map = new Map(prev.map((g) => [g.group_id, g]));
            for (const ug of updatedGroups) {
              map.set(ug.group_id, ug);
            }
            return Array.from(map.values()).sort((a, b) => a.group_id - b.group_id);
          });
        },
        (connected) => {
          setWsConnected(connected);
        }
      );

      return () => unsubscribe();
    }
  }, [isAuthenticated, loadData]);

  // Deep Link / URL support for direct modal: /zone/:id or /dashboard/zone/:id
  useEffect(() => {
    if (route.groupId && groups.length > 0) {
      const target = groups.find((g) => g.group_id === route.groupId);
      if (target) {
        setSelectedGroup(target);
      }
    } else if (!route.groupId && selectedGroup && route.path.startsWith('/zone')) {
      setSelectedGroup(null);
    }
  }, [route.groupId, groups]);

  // Keep selectedGroup in sync with live updates
  useEffect(() => {
    if (selectedGroup) {
      const live = groups.find((g) => g.group_id === selectedGroup.group_id);
      if (live) setSelectedGroup(live);
    }
  }, [groups]);

  // Guard: if non-admin tries to navigate to /admin, redirect to /dashboard
  useEffect(() => {
    if (isAuthenticated && route.tab === 'admin' && user?.role !== 'admin') {
      goTo('/dashboard');
    }
  }, [isAuthenticated, route.tab, user?.role, goTo]);

  // Loading Screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="text-xs font-semibold tracking-wider uppercase">Loading GB-50 Centralized Gateway...</span>
      </div>
    );
  }

  // If not authenticated, render Login Screen
  if (!isAuthenticated) {
    return <LoginView onSuccess={loadData} />;
  }

  // Navigation tab change
  const handleTabChange = (tab: MainTab) => {
    if (tab === 'dashboard') {
      goTo('/dashboard');
    } else if (tab === 'ventilation') {
      goTo('/ventilation');
    } else if (tab === 'schedules') {
      goTo('/schedules/' + (route.scheduleSubTab || 'schedules'));
    } else if (tab === 'admin') {
      if (user?.role === 'admin') {
        goTo('/admin/' + (route.adminSubTab || 'system'));
      }
    }
  };

  // Actions
  const handleTogglePower = async (group: GroupStatus) => {
    const nextDrive = group.drive === 'ON' ? 'OFF' : 'ON';
    await controlGroup(group.group_id, { drive: nextDrive });
  };

  const handleControlGroup = async (groupId: number, request: GroupControlRequest) => {
    await controlGroup(groupId, request);
  };

  const handleRenameGroup = async (groupId: number, newName: string) => {
    await renameGroup(groupId, newName);
  };

  const handleBatchControl = async (updates: Record<number, GroupControlRequest>) => {
    await batchControl(updates);
  };

  const handleApplyPreset = async (preset: string) => {
    await applyPreset(preset);
  };

  const handleResetFilter = async (groupId: number) => {
    await resetFilter(groupId);
  };

  const handleOpenZoneModal = (group: GroupStatus) => {
    setSelectedGroup(group);
    goTo(`/zone/${group.group_id}`);
  };

  const handleCloseZoneModal = () => {
    setSelectedGroup(null);
    if (route.path.startsWith('/zone')) {
      goTo('/dashboard');
    }
  };

  // Counters
  const runningCount = groups.filter((g) => g.drive === 'ON').length;
  const dirtyFilterCount = groups.filter((g) => g.filter_dirty).length;
  const alarmCount = groups.filter((g) => g.error_active).length;

  return (
    <div className="app min-h-screen flex flex-col selection:bg-blue-500 selection:text-white">
      {/* Header Bar */}
      <Header
        systemInfo={systemInfo}
        wsConnected={wsConnected}
        activeTab={route.tab}
        setActiveTab={handleTabChange}
        tempUnit={tempUnit}
        setTempUnit={setTempUnit}
        runningCount={runningCount}
        dirtyFilterCount={dirtyFilterCount}
        alarmCount={alarmCount}
      />

      {/* Main View Area */}
      <main className={route.tab === 'schedules' ? 'flex-1' : 'flex-1 pb-16 max-w-7xl mx-auto px-4 w-full'}>
        {route.tab === 'dashboard' && (
          <Dashboard
            groups={groups}
            tempUnit={tempUnit}
            onTogglePower={handleTogglePower}
            onOpenDetails={handleOpenZoneModal}
            onResetFilter={handleResetFilter}
            onBatchControl={handleBatchControl}
            onApplyPreset={handleApplyPreset}
            initialFilter={route.dashboardFilter}
            onFilterChange={(f) => goTo(f === 'all' ? '/dashboard' : `/dashboard?floor=${f}`)}
          />
        )}

        {route.tab === 'ventilation' && (
          <VentilationView
            groups={groups}
            onControlGroup={handleControlGroup}
            onResetFilter={handleResetFilter}
          />
        )}

        {route.tab === 'schedules' && (
          <ScheduleView 
            groups={groups} 
            tempUnit={tempUnit}
            activeMode={route.scheduleSubTab}
            onModeChange={(mode) => goTo(`/schedules/${mode}`)}
          />
        )}

        {route.tab === 'admin' && user?.role === 'admin' && (
          <AdminPanel
            systemInfo={systemInfo}
            groups={groups}
            tempUnit={tempUnit}
            onRefreshGroups={loadData}
            activeSubTab={route.adminSubTab}
            onSubTabChange={(sub) => goTo(`/admin/${sub}`)}
          />
        )}
      </main>

      {/* Modal Dialog for Group Control (Deep Linkable / Sharable) */}
      {selectedGroup && (
        <ZoneControlModal
          group={selectedGroup}
          tempUnit={tempUnit}
          onClose={handleCloseZoneModal}
          onSave={handleControlGroup}
          onRename={handleRenameGroup}
          onResetFilter={handleResetFilter}
        />
      )}

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>{systemInfo?.system_name || 'GB-50 Central Controller'} • {systemInfo?.model || 'Mitsubishi GB-50'}</span>
          <span>REST API & WebSocket Proxy v1.0.0</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
