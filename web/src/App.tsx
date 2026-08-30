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
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { VentilationView } from './components/VentilationView';
import { ScheduleView } from './components/ScheduleView';
import { AdminPanel } from './components/AdminPanel';
import { ZoneControlModal } from './components/ZoneControlModal';

export const App: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [groups, setGroups] = useState<GroupStatus[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ventilation' | 'schedules' | 'admin'>('dashboard');
  const [tempUnit, setTempUnit] = useState<'F' | 'C'>('F');
  const [selectedGroup, setSelectedGroup] = useState<GroupStatus | null>(null);
  const [loadingPreset, setLoadingPreset] = useState(false);

  // Initial Load
  const loadData = useCallback(async () => {
    try {
      const [sys, grps] = await Promise.all([fetchSystemInfo(), fetchGroups()]);
      setSystemInfo(sys);
      setGroups(grps);
    } catch (err) {
      console.error('Failed to load initial controller data:', err);
    }
  }, []);

  useEffect(() => {
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
  }, [loadData]);

  // Keep selectedGroup in sync with live updates
  useEffect(() => {
    if (selectedGroup) {
      const live = groups.find((g) => g.group_id === selectedGroup.group_id);
      if (live) setSelectedGroup(live);
    }
  }, [groups]);

  // Actions
  const handleTogglePower = async (group: GroupStatus) => {
    const nextDrive = group.drive === 'ON' ? 'OFF' : 'ON';
    await controlGroup(group.group_id, { drive: nextDrive });
  };

  const handleControlGroup = async (groupId: number, request: GroupControlRequest) => {
    await controlGroup(groupId, request);
  };

  const handleBatchControl = async (updates: Record<number, GroupControlRequest>) => {
    await batchControl(updates);
  };

  const handleApplyPreset = async (preset: 'sunday' | 'all_off' | 'office' | 'night') => {
    setLoadingPreset(true);
    try {
      await applyPreset(preset);
    } catch (err) {
      console.error('Failed to apply preset:', err);
    } finally {
      setLoadingPreset(false);
    }
  };

  const handleResetFilter = async (groupId: number) => {
    await resetFilter(groupId);
  };

  const handleRenameGroup = async (groupId: number, newName: string) => {
    await renameGroup(groupId, newName);
    await loadData();
  };

  const runningCount = groups.filter((g) => g.drive === 'ON').length;
  const dirtyFilterCount = groups.filter((g) => g.filter_dirty).length;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
      {/* Header */}
      <Header
        systemInfo={systemInfo}
        wsConnected={wsConnected}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tempUnit={tempUnit}
        setTempUnit={setTempUnit}
        onApplyPreset={handleApplyPreset}
        runningCount={runningCount}
        dirtyFilterCount={dirtyFilterCount}
        alarmCount={0}
        loadingPreset={loadingPreset}
      />

      {/* Main View Area */}
      <main className="flex-1">
        {activeTab === 'dashboard' && (
          <Dashboard
            groups={groups}
            tempUnit={tempUnit}
            onTogglePower={handleTogglePower}
            onOpenDetails={(group) => setSelectedGroup(group)}
            onResetFilter={handleResetFilter}
            onBatchControl={handleBatchControl}
          />
        )}

        {activeTab === 'ventilation' && (
          <VentilationView
            groups={groups}
            onControlGroup={handleControlGroup}
            onResetFilter={handleResetFilter}
          />
        )}

        {activeTab === 'schedules' && (
          <ScheduleView groups={groups} tempUnit={tempUnit} />
        )}

        {activeTab === 'admin' && (
          <AdminPanel
            systemInfo={systemInfo}
            groups={groups}
            tempUnit={tempUnit}
            onRefreshGroups={loadData}
          />
        )}
      </main>

      {/* Modal Dialog for Group Control */}
      {selectedGroup && (
        <ZoneControlModal
          group={selectedGroup}
          tempUnit={tempUnit}
          onClose={() => setSelectedGroup(null)}
          onSave={handleControlGroup}
          onRename={handleRenameGroup}
          onResetFilter={handleResetFilter}
        />
      )}

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Example Facility HVAC Control Gateway • Mitsubishi GB-50ADA-A</span>
          <span>REST API & WebSocket Proxy v1.0.0</span>
        </div>
      </footer>
    </div>
  );
};
export default App;
