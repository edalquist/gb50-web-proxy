import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  Network, 
  ShieldCheck, 
  AlertTriangle, 
  Key, 
  RefreshCw, 
  Layers,
  Wind,
  Moon,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Wrench,
  Info,
  Activity,
  Filter,
  UserPlus,
  Edit2,
  X,
  Eye
} from 'lucide-react';
import { 
  GroupStatus, 
  SystemInfo, 
  AlarmRecord, 
  GroupConfigPayload,
  UserProfile,
  UserRole
} from '../types';
import { 
  fetchAlarms, 
  clearAlarms,
  fetchClock, 
  syncClock, 
  fetchProxyUsers,
  createProxyUser,
  updateProxyUser,
  deleteProxyUser,
  createGroup,
  updateGroupConfig,
  deleteGroup,
  fetchUnassignedAddresses,
  updateSystemInfo,
  fetchInterlocks,
  updateInterlocks,
  fetchSummerTime,
  updateSummerTime,
  fetchSetback,
  updateSetback,
  registerOptionLicense
} from '../api';

type AdminSubTab = 
  | 'system' 
  | 'zones' 
  | 'interlocks' 
  | 'clock' 
  | 'setback' 
  | 'licenses' 
  | 'security' 
  | 'diagnostics';

interface AdminPanelProps {
  systemInfo: SystemInfo | null;
  groups: GroupStatus[];
  tempUnit?: 'F' | 'C';
  onRefreshGroups: () => Promise<void>;
  activeSubTab?: AdminSubTab;
  onSubTabChange?: (tab: AdminSubTab) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  systemInfo,
  groups,
  onRefreshGroups,
  activeSubTab,
  onSubTabChange,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>(activeSubTab || 'system');

  useEffect(() => {
    if (activeSubTab && activeSubTab !== subTab) {
      setSubTab(activeSubTab);
    }
  }, [activeSubTab]);

  const handleSelectSubTab = (tab: AdminSubTab) => {
    setSubTab(tab);
    onSubTabChange?.(tab);
  };

  // --- Subtab 1: System Data State ---
  const [sysForm, setSysForm] = useState({
    system_name: systemInfo?.system_name || 'GB-50 Central Controller',
    location_id: systemInfo?.location_id || '000001',
    ip_address: systemInfo?.ip_address || '192.0.2.90',
    subnet_mask: systemInfo?.subnet_mask || '255.255.255.0',
    gateway: systemInfo?.gateway || '192.0.2.1',
    mnet_address: systemInfo?.mnet_address || 0,
    temp_unit: systemInfo?.temp_unit || 'F',
    date_format: systemInfo?.date_format || 'MMDDYYYY',
    time_format: systemInfo?.time_format || '12',
    room_temp_display: 'SHOW_ALWAYS',
    filter_sign_display: 'ON',
    short_name_display: 'ON',
    time_master: 'MASTER',
    use_ec: 'NOT_USE',
    prohibit_level: 'RC_ONLY',
    external_input: 'WITHOUT',
  });
  const [sysMsg, setSysMsg] = useState<string | null>(null);
  const [isSavingSys, setIsSavingSys] = useState(false);

  useEffect(() => {
    if (systemInfo) {
      setSysForm((prev) => ({
        ...prev,
        system_name: systemInfo.system_name,
        location_id: systemInfo.location_id,
        ip_address: systemInfo.ip_address,
        subnet_mask: systemInfo.subnet_mask,
        gateway: systemInfo.gateway,
        mnet_address: systemInfo.mnet_address,
        temp_unit: systemInfo.temp_unit,
        date_format: systemInfo.date_format,
        time_format: systemInfo.time_format,
      }));
    }
  }, [systemInfo]);

  const handleSaveSystemData = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSys(true);
    setSysMsg(null);
    try {
      const res = await updateSystemInfo(sysForm);
      setSysMsg(res.message);
      await onRefreshGroups();
    } catch (err: any) {
      setSysMsg(`Error: ${err.message}`);
    } finally {
      setIsSavingSys(false);
    }
  };

  // --- Subtab 2: Group Hardware Mapping & CRUD State ---
  const [selectedGroupConfig, setSelectedGroupConfig] = useState<GroupStatus | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editPrimaryIc, setEditPrimaryIc] = useState(1);
  const [editModel, setEditModel] = useState<'IC' | 'LC'>('IC');
  const [editFloor, setEditFloor] = useState(1);
  const [editSlavesStr, setEditSlavesStr] = useState('');
  const [editRcsStr, setEditRcsStr] = useState('');
  const [groupConfigMsg, setGroupConfigMsg] = useState<string | null>(null);
  const [isSavingGroupConfig, setIsSavingGroupConfig] = useState(false);

  // Unassigned addresses state
  const [unassignedAddresses, setUnassignedAddresses] = useState<number[]>([]);
  const [loadingUnassigned, setLoadingUnassigned] = useState(false);

  // Create Group Modal State
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [newGroupId, setNewGroupId] = useState(1);
  const [newGroupName, setNewGroupName] = useState('');
  const [newPrimaryIc, setNewPrimaryIc] = useState(1);
  const [newModel, setNewModel] = useState<'IC' | 'LC'>('IC');
  const [newFloor, setNewFloor] = useState(1);
  const [newSlavesStr, setNewSlavesStr] = useState('');

  // Delete confirmation modal state
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<GroupStatus | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  const loadUnassignedAddresses = async () => {
    setLoadingUnassigned(true);
    try {
      const data = await fetchUnassignedAddresses();
      setUnassignedAddresses(data.unassigned_addresses || []);
    } catch (err) {
      console.error('Failed to load unassigned addresses:', err);
    } finally {
      setLoadingUnassigned(false);
    }
  };

  useEffect(() => {
    if (subTab === 'zones') {
      loadUnassignedAddresses();
    }
  }, [subTab, groups]);

  const openCreateGroupModal = () => {
    // Find first unused Group ID (1..50)
    const existingGids = new Set(groups.map((g) => g.group_id));
    let nextGid = 1;
    while (existingGids.has(nextGid) && nextGid <= 50) nextGid++;

    // Find first unassigned M-NET address
    const firstFreeAddr = unassignedAddresses.length > 0 ? unassignedAddresses[0] : nextGid;

    setNewGroupId(nextGid);
    setNewGroupName(`Zone ${nextGid}`);
    setNewPrimaryIc(firstFreeAddr);
    setNewModel('IC');
    setNewFloor(nextGid > 18 ? 2 : 1);
    setNewSlavesStr('');
    setGroupConfigMsg(null);
    setIsCreateGroupOpen(true);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGroupConfig(true);
    setGroupConfigMsg(null);
    try {
      const slaves = newSlavesStr
        .split(',')
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n));

      const payload: GroupConfigPayload = {
        group_id: newGroupId,
        name: newGroupName,
        primary_ic: newPrimaryIc,
        model: newModel,
        slave_ics: slaves,
        floor: newFloor,
      };

      const res = await createGroup(payload);
      setGroupConfigMsg(res.message || `Successfully created Group ${newGroupId}`);
      await onRefreshGroups();
      await loadUnassignedAddresses();
      setIsCreateGroupOpen(false);
    } catch (err: any) {
      setGroupConfigMsg(`Error: ${err.message}`);
    } finally {
      setIsSavingGroupConfig(false);
    }
  };

  const openGroupConfig = (g: GroupStatus) => {
    setSelectedGroupConfig(g);
    setEditGroupName(g.name);
    setEditPrimaryIc(g.address);
    setEditModel(g.model === 'LC' ? 'LC' : 'IC');
    setEditFloor(((g as { floor?: number }).floor ?? 1) === 2 ? 2 : 1);
    setEditSlavesStr(g.slave_addresses.join(', '));
    setEditRcsStr('');
    setGroupConfigMsg(null);
  };

  const handleSaveGroupConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupConfig) return;
    setIsSavingGroupConfig(true);
    setGroupConfigMsg(null);
    try {
      const slaves = editSlavesStr
        .split(',')
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n));
      const rcs = editRcsStr
        .split(',')
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n));

      const payload: GroupConfigPayload = {
        name: editGroupName,
        primary_ic: editPrimaryIc,
        model: editModel,
        slave_ics: slaves,
        rcs: rcs,
        floor: editFloor,
      };

      const res = await updateGroupConfig(selectedGroupConfig.group_id, payload);
      setGroupConfigMsg(res.message);
      await onRefreshGroups();
      await loadUnassignedAddresses();
      setSelectedGroupConfig(null);
    } catch (err: any) {
      setGroupConfigMsg(`Error: ${err.message}`);
    } finally {
      setIsSavingGroupConfig(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteConfirmGroup) return;
    setIsDeletingGroup(true);
    try {
      await deleteGroup(deleteConfirmGroup.group_id);
      setDeleteConfirmGroup(null);
      await onRefreshGroups();
      await loadUnassignedAddresses();
    } catch (err: any) {
      alert(`Failed to delete group: ${err.message}`);
    } finally {
      setIsDeletingGroup(false);
    }
  };

  // --- Subtab 3: Interlocks State ---
  const [interlocks, setInterlocks] = useState<Array<{ ic_address: number; lc_address: number }>>([]);
  const [newIcAddr, setNewIcAddr] = useState(1);
  const [newLcAddr, setNewLcAddr] = useState(15);
  const [interlockMsg, setInterlockMsg] = useState<string | null>(null);
  const [isSavingInterlocks, setIsSavingInterlocks] = useState(false);

  const loadInterlocks = async () => {
    try {
      const list = await fetchInterlocks();
      setInterlocks(list);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddInterlock = () => {
    if (!interlocks.some((i) => i.ic_address === newIcAddr)) {
      setInterlocks([...interlocks, { ic_address: newIcAddr, lc_address: newLcAddr }]);
    }
  };

  const handleRemoveInterlock = (ic: number) => {
    setInterlocks(interlocks.filter((i) => i.ic_address !== ic));
  };

  const handleSaveInterlocks = async () => {
    setIsSavingInterlocks(true);
    setInterlockMsg(null);
    try {
      const res = await updateInterlocks(interlocks);
      setInterlockMsg(res.message);
    } catch (err: any) {
      setInterlockMsg(`Error: ${err.message}`);
    } finally {
      setIsSavingInterlocks(false);
    }
  };

  // --- Subtab 4: Clock & Summer Time State ---
  const [clockTime, setClockTime] = useState<string>('');
  const [isSyncingClock, setIsSyncingClock] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [summerTimeForm, setSummerTimeForm] = useState({
    country_code: 'US0',
    month1: '3',
    day1: '8',
    hour1: '2',
    minute1: '0',
    shift_min1: '60',
    month2: '11',
    day2: '1',
    hour2: '2',
    minute2: '0',
    shift_min2: '-60',
  });
  const [summerTimeMsg, setSummerTimeMsg] = useState<string | null>(null);

  const loadClock = async () => {
    try {
      const data = await fetchClock();
      setClockTime(data.current_time);
      const st = await fetchSummerTime();
      if (st && st.month1) {
        setSummerTimeForm({
          country_code: st.country_code || 'US0',
          month1: st.month1 || '3',
          day1: st.day1 || '8',
          hour1: st.hour1 || '2',
          minute1: st.minute1 || '0',
          shift_min1: st.shift_min1 || '60',
          month2: st.month2 || '11',
          day2: st.day2 || '1',
          hour2: st.hour2 || '2',
          minute2: st.minute2 || '0',
          shift_min2: st.shift_min2 || '-60',
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncClock = async () => {
    setIsSyncingClock(true);
    setSyncMessage(null);
    try {
      const res = await syncClock();
      setClockTime(res.synchronized_time);
      setSyncMessage('Controller clock successfully synchronized with local device time!');
    } catch (err: any) {
      setSyncMessage(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncingClock(false);
    }
  };

  const handleSaveSummerTime = async (e: React.FormEvent) => {
    e.preventDefault();
    setSummerTimeMsg(null);
    try {
      const res = await updateSummerTime(summerTimeForm);
      setSummerTimeMsg(res.message);
    } catch (err: any) {
      setSummerTimeMsg(`Error: ${err.message}`);
    }
  };

  // --- Subtab 5: Night Setback State ---
  const [setbackForm, setSetbackForm] = useState({
    enabled: false,
    start_hour: 22,
    start_minute: 0,
    end_hour: 6,
    end_minute: 0,
  });
  const [setbackMsg, setSetbackMsg] = useState<string | null>(null);
  const [isSavingSetback, setIsSavingSetback] = useState(false);

  const loadSetback = async () => {
    try {
      const sb = await fetchSetback();
      setSetbackForm({
        enabled: sb.enabled ?? false,
        start_hour: sb.start_hour ?? 22,
        start_minute: sb.start_minute ?? 0,
        end_hour: sb.end_hour ?? 6,
        end_minute: sb.end_minute ?? 0,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSetback = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSetback(true);
    setSetbackMsg(null);
    try {
      const res = await updateSetback(setbackForm);
      setSetbackMsg(res.message);
    } catch (err: any) {
      setSetbackMsg(`Error: ${err.message}`);
    } finally {
      setIsSavingSetback(false);
    }
  };

  // --- Subtab 6: License Registration State ---
  const [regFuncIndex, setRegFuncIndex] = useState<number>(1);
  const [regKeyCode, setRegKeyCode] = useState<string>('');
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);
  const [isRegisteringLicense, setIsRegisteringLicense] = useState(false);

  const handleRegisterLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regKeyCode.length !== 16) {
      setLicenseMsg('Key code must be exactly 16 characters');
      return;
    }
    setIsRegisteringLicense(true);
    setLicenseMsg(null);
    try {
      const res = await registerOptionLicense(regFuncIndex, regKeyCode);
      setLicenseMsg(res.message);
      setRegKeyCode('');
      await onRefreshGroups();
    } catch (err: any) {
      setLicenseMsg(`Error: ${err.message}`);
    } finally {
      setIsRegisteringLicense(false);
    }
  };

  // --- Subtab 7: User Security & RBAC State ---
  const [proxyUsers, setProxyUsers] = useState<UserProfile[]>([]);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<UserProfile | null>(null);
  const [userActionMsg, setUserActionMsg] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);

  const [newUserForm, setNewUserForm] = useState({
    username: '',
    password: '',
    role: 'operator' as UserRole,
    display_name: '',
  });

  const [editUserForm, setEditUserForm] = useState({
    role: 'operator' as UserRole,
    display_name: '',
    new_password: '',
    enabled: true,
  });

  const loadUsers = async () => {
    try {
      const data = await fetchProxyUsers();
      setProxyUsers(data);
    } catch (err) {
      console.error('Failed to load proxy users:', err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.username.trim() || !newUserForm.password.trim() || !newUserForm.display_name.trim()) {
      setUserActionMsg('Please fill in all user fields.');
      return;
    }
    setIsSavingUser(true);
    setUserActionMsg(null);
    try {
      await createProxyUser({
        username: newUserForm.username.trim(),
        password: newUserForm.password.trim(),
        role: newUserForm.role,
        display_name: newUserForm.display_name.trim(),
      });
      setUserActionMsg(`User '${newUserForm.username}' created successfully!`);
      setIsCreateUserModalOpen(false);
      setNewUserForm({ username: '', password: '', role: 'operator', display_name: '' });
      await loadUsers();
    } catch (err: any) {
      setUserActionMsg(`Error creating user: ${err.message}`);
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleStartEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setEditUserForm({
      role: u.role,
      display_name: u.display_name,
      new_password: '',
      enabled: u.enabled !== false,
    });
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsSavingUser(true);
    setUserActionMsg(null);
    try {
      await updateProxyUser(editingUser.id, {
        role: editUserForm.role,
        display_name: editUserForm.display_name.trim(),
        enabled: editUserForm.enabled,
        new_password: editUserForm.new_password.trim() ? editUserForm.new_password.trim() : undefined,
      });
      setUserActionMsg(`User '${editingUser.username}' updated successfully!`);
      setEditingUser(null);
      await loadUsers();
    } catch (err: any) {
      setUserActionMsg(`Error updating user: ${err.message}`);
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteConfirmUser) return;
    setIsSavingUser(true);
    setUserActionMsg(null);
    try {
      await deleteProxyUser(deleteConfirmUser.id);
      setUserActionMsg(`User '${deleteConfirmUser.username}' deleted.`);
      setDeleteConfirmUser(null);
      await loadUsers();
    } catch (err: any) {
      setUserActionMsg(`Error deleting user: ${err.message}`);
    } finally {
      setIsSavingUser(false);
    }
  };

  // --- Subtab 8: Alarms State ---
  const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
  const [alarmFilter, setAlarmFilter] = useState<'all' | 'active' | 'resolved' | 'sensors' | 'power' | 'comm'>('all');
  const [isClearingAlarms, setIsClearingAlarms] = useState(false);
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null);

  const loadAlarms = async () => {
    try {
      const data = await fetchAlarms();
      setAlarms(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAlarmHistory = async () => {
    if (!confirm('Are you sure you want to clear the resolved malfunction history from the controller memory?')) return;
    setIsClearingAlarms(true);
    setAlarmMsg(null);
    try {
      const res = await clearAlarms();
      setAlarmMsg(res.message);
      await loadAlarms();
    } catch (err: any) {
      setAlarmMsg(`Error: ${err.message}`);
    } finally {
      setIsClearingAlarms(false);
    }
  };

  useEffect(() => {
    loadAlarms();
    loadClock();
    loadUsers();
    loadInterlocks();
    loadSetback();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Admin Navigation Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800">
        {[
          { id: 'system', label: 'Basic System & Network', icon: Network },
          { id: 'zones', label: 'Zone & Hardware Mapping', icon: Layers },
          { id: 'interlocks', label: 'LOSSNAY Interlocks', icon: Wind },
          { id: 'clock', label: 'Clock & Summer Time (DST)', icon: Clock },
          { id: 'setback', label: 'Night Setback Automation', icon: Moon },
          { id: 'licenses', label: 'Software Licenses', icon: ShieldCheck },
          { id: 'security', label: 'User Security & Accounts', icon: Key },
          { id: 'diagnostics', label: `Alarms & Diagnostics (${alarms.length})`, icon: AlertTriangle },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleSelectSubTab(id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              subTab === id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Subtab 1: Basic System & Network Settings (100% BasicSettingsPanel coverage) */}
      {subTab === 'system' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <Network className="w-5 h-5 text-blue-400" />
              Basic System, Network & Global Display Settings
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Configure controller identity, LAN IP addressing, M-Net network parameters, and global display preferences.
            </p>
          </div>

          <form onSubmit={handleSaveSystemData} className="space-y-6">
            {/* Unit Identity */}
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
                1. Unit Identity & Specifications
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Facility Name:</label>
                  <input
                    type="text"
                    maxLength={40}
                    value={sysForm.system_name}
                    onChange={(e) => setSysForm({ ...sysForm, system_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-semibold"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Location ID (6 digits):</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={sysForm.location_id}
                    onChange={(e) => setSysForm({ ...sysForm, location_id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Controller Model (Read-Only):</label>
                  <input
                    type="text"
                    disabled
                    value={systemInfo?.model || 'GB-50ADA-A'}
                    className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-400 font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Firmware Version (Read-Only):</label>
                  <input
                    type="text"
                    disabled
                    value={systemInfo?.version || '2.80'}
                    className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-400 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Network Settings */}
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
                2. Ethernet LAN Network Configuration
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">IP Address:</label>
                  <input
                    type="text"
                    value={sysForm.ip_address}
                    onChange={(e) => setSysForm({ ...sysForm, ip_address: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Subnet Mask:</label>
                  <input
                    type="text"
                    value={sysForm.subnet_mask}
                    onChange={(e) => setSysForm({ ...sysForm, subnet_mask: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Default Gateway:</label>
                  <input
                    type="text"
                    value={sysForm.gateway}
                    onChange={(e) => setSysForm({ ...sysForm, gateway: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Central M-Net Address:</label>
                  <input
                    type="number"
                    min={0}
                    max={250}
                    value={sysForm.mnet_address}
                    onChange={(e) => setSysForm({ ...sysForm, mnet_address: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Display Formats & Global Behaviors */}
            <div>
              <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
                3. Display Formats & System Modes
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Temperature Display Unit:</label>
                  <select
                    value={sysForm.temp_unit}
                    onChange={(e) => setSysForm({ ...sysForm, temp_unit: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500"
                  >
                    <option value="F">Fahrenheit (°F)</option>
                    <option value="C">Celsius (°C)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Date Format:</label>
                  <select
                    value={sysForm.date_format}
                    onChange={(e) => setSysForm({ ...sysForm, date_format: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500"
                  >
                    <option value="MMDDYYYY">MM/DD/YYYY</option>
                    <option value="DDMMYYYY">DD/MM/YYYY</option>
                    <option value="YYYYMMDD">YYYY/MM/DD</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Time Format:</label>
                  <select
                    value={sysForm.time_format}
                    onChange={(e) => setSysForm({ ...sysForm, time_format: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500"
                  >
                    <option value="12">12 Hour (AM/PM)</option>
                    <option value="24">24 Hour (Military)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Room Temp Display:</label>
                  <select
                    value={sysForm.room_temp_display}
                    onChange={(e) => setSysForm({ ...sysForm, room_temp_display: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500"
                  >
                    <option value="SHOW_ALWAYS">Show Always</option>
                    <option value="SHOW_DRIVING">Show Only When Running</option>
                    <option value="HIDE">Hide Room Temp</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Save Button & Feedback */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              {sysMsg ? (
                <div className="text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-xl">
                  {sysMsg}
                </div>
              ) : <div />}
              <button
                type="submit"
                disabled={isSavingSys}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900 transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSavingSys ? 'Saving...' : 'Save System Configuration to Controller'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Subtab 2: Group Hardware & M-Net Mapping (Full CRUD Management) */}
      {subTab === 'zones' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
          <div className="border-b border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-400" />
                Group Hardware Configuration & M-Net Topology
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Provision new groups, rename zones, assign primary/slave M-Net addresses (1..50), configure floor mappings, or unassign groups.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={openCreateGroupModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-900 transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Provision New Group
              </button>
              <button
                onClick={() => {
                  onRefreshGroups();
                  loadUnassignedAddresses();
                }}
                className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition"
                title="Refresh hardware topology"
              >
                <RefreshCw className={`w-4 h-4 ${loadingUnassigned ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Unassigned M-NET Addresses Banner */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                M-NET Hardware Address Status ({groups.length} Groups Configured • {unassignedAddresses.length} Addresses Available)
              </span>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Addresses 1 to 50
              </span>
            </div>

            {unassignedAddresses.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] text-slate-400 self-center mr-1">Available to assign:</span>
                {unassignedAddresses.slice(0, 20).map((addr) => (
                  <span
                    key={addr}
                    className="px-2 py-0.5 bg-slate-900 text-slate-300 rounded font-mono text-[10px] border border-slate-800"
                  >
                    Addr {addr}
                  </span>
                ))}
                {unassignedAddresses.length > 20 && (
                  <span className="text-[10px] text-slate-500 self-center font-mono">
                    +{unassignedAddresses.length - 20} more...
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-400 italic">
                All 50 M-NET hardware addresses are currently mapped to active groups.
              </p>
            )}
          </div>

          {groupConfigMsg && (
            <div className="p-3.5 bg-blue-500/10 border border-blue-500/30 rounded-2xl text-xs font-semibold text-blue-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span>{groupConfigMsg}</span>
            </div>
          )}

          {/* Group Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                <tr>
                  <th className="p-3">Group</th>
                  <th className="p-3">Display Name</th>
                  <th className="p-3">Floor</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Primary M-Net Address</th>
                  <th className="p-3">Secondary Slave Units</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {groups.map((g) => (
                  <tr key={g.group_id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-bold text-blue-400">Group {g.group_id}</td>
                    <td className="p-3 font-sans font-bold text-slate-100">{g.name}</td>
                    <td className="p-3 font-sans">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        {((g as { floor?: number }).floor ?? 1) === 2 ? 'Floor 2' : 'Floor 1'}
                      </span>
                    </td>
                    <td className="p-3 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          g.model === 'LC'
                            ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}
                      >
                        {g.model === 'LC' ? 'LC (LOSSNAY)' : 'IC (Indoor Unit)'}
                      </span>
                    </td>
                    <td className="p-3">Address {g.address}</td>
                    <td className="p-3 text-slate-400">
                      {g.slave_addresses.length > 0 ? g.slave_addresses.join(', ') : 'None'}
                    </td>
                    <td className="p-3 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openGroupConfig(g)}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirmGroup(g)}
                          className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-lg font-semibold transition border border-rose-800/40"
                          title="Delete Group"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MODAL 1: Create / Provision New Group */}
          {isCreateGroupOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-blue-400" />
                    Provision New HVAC Control Group
                  </h3>
                  <button
                    onClick={() => setIsCreateGroupOpen(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateGroup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Group ID (1..50):</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={newGroupId}
                        onChange={(e) => setNewGroupId(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Floor Assignment:</label>
                      <select
                        value={newFloor}
                        onChange={(e) => setNewFloor(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
                      >
                        <option value={1}>Floor 1 (Ground Floor)</option>
                        <option value={2}>Floor 2 (Second Floor)</option>
                        <option value={3}>Floor 3</option>
                        <option value={4}>Floor 4</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">Group Display Name:</label>
                    <input
                      type="text"
                      maxLength={20}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
                      placeholder="e.g. Youth Ministry Room"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Unit Model Type:</label>
                      <select
                        value={newModel}
                        onChange={(e) => setNewModel(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
                      >
                        <option value="IC">IC (Indoor Fan Coil)</option>
                        <option value="LC">LC (LOSSNAY Ventilator)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Primary M-Net Address (1..50):</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={newPrimaryIc}
                        onChange={(e) => setNewPrimaryIc(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">
                      Secondary Slave Unit Addresses (Optional, comma-separated):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 32, 33"
                      value={newSlavesStr}
                      onChange={(e) => setNewSlavesStr(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsCreateGroupOpen(false)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingGroupConfig}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-blue-900 disabled:opacity-50"
                    >
                      {isSavingGroupConfig ? 'Provisioning...' : 'Provision Group in Controller'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MODAL 2: Edit Group Hardware Configuration */}
          {selectedGroupConfig && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-5">
                <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
                  <h3 className="font-bold text-base text-white">
                    Configure Group {selectedGroupConfig.group_id} Hardware Mapping
                  </h3>
                  <button
                    onClick={() => setSelectedGroupConfig(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveGroupConfig} className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">Group Display Name:</label>
                    <input
                      type="text"
                      maxLength={20}
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-bold"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Unit Model:</label>
                      <select
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500"
                      >
                        <option value="IC">IC (Indoor Unit)</option>
                        <option value="LC">LC (LOSSNAY)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Primary Address:</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={editPrimaryIc}
                        onChange={(e) => setEditPrimaryIc(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-400 block mb-1">Floor:</label>
                      <select
                        value={editFloor}
                        onChange={(e) => setEditFloor(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      >
                        <option value={1}>Floor 1</option>
                        <option value={2}>Floor 2</option>
                        <option value={3}>Floor 3</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">
                      Secondary Slave Unit Addresses (e.g. 2, 3):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 2, 3"
                      value={editSlavesStr}
                      onChange={(e) => setEditSlavesStr(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1">
                      Remote Controller (RC) Addresses (101..200):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 101, 102"
                      value={editRcsStr}
                      onChange={(e) => setEditRcsStr(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500 font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setSelectedGroupConfig(null)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingGroupConfig}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-blue-900 disabled:opacity-50"
                    >
                      {isSavingGroupConfig ? 'Saving...' : 'Apply & Save Topology'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MODAL 3: Delete Group Confirmation Dialog */}
          {deleteConfirmGroup && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-rose-500/40 rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
                <div className="flex items-center gap-3 text-rose-400">
                  <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/20">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-white">Delete Group {deleteConfirmGroup.group_id}?</h3>
                    <p className="text-xs text-slate-400">"{deleteConfirmGroup.name}"</p>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  This will unassign physical M-NET address <strong className="text-white">Address {deleteConfirmGroup.address}</strong> and clear this group's name and schedules from the GB-50 controller memory.
                </p>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmGroup(null)}
                    disabled={isDeletingGroup}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteGroup}
                    disabled={isDeletingGroup}
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-rose-950 disabled:opacity-50"
                  >
                    {isDeletingGroup ? 'Deleting...' : 'Yes, Delete Group'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: LOSSNAY Interlocks (100% InterlockedSettingsPanel coverage) */}
      {subTab === 'interlocks' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <Wind className="w-5 h-5 text-teal-400" />
              LOSSNAY Interlocked Ventilation Pairings
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Pair Indoor Fan Coil units (`IC`) with dedicated LOSSNAY energy recovery ventilators (`LC`).
            </p>
          </div>

          {/* Add Pairing Form */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Indoor Unit (IC):</label>
              <select
                value={newIcAddr}
                onChange={(e) => setNewIcAddr(parseInt(e.target.value))}
                className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-1.5"
              >
                {groups
                  .filter((g) => g.model === 'IC')
                  .map((g) => (
                    <option key={g.address} value={g.address}>
                      {g.name} (Address {g.address})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">LOSSNAY Unit (LC):</label>
              <select
                value={newLcAddr}
                onChange={(e) => setNewLcAddr(parseInt(e.target.value))}
                className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-3 py-1.5"
              >
                {groups
                  .filter((g) => g.model === 'LC')
                  .map((g) => (
                    <option key={g.address} value={g.address}>
                      {g.name} (Address {g.address})
                    </option>
                  ))}
              </select>
            </div>

            <button
              onClick={handleAddInterlock}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition self-end"
            >
              <Plus className="w-4 h-4" />
              Add Interlock Pairing
            </button>
          </div>

          {/* Interlocks List */}
          <div className="space-y-2">
            {interlocks.length > 0 ? (
              interlocks.map((item) => (
                <div
                  key={item.ic_address}
                  className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="px-2.5 py-1 bg-blue-500/20 text-blue-300 rounded font-mono text-xs font-bold">
                      IC Address {item.ic_address}
                    </div>
                    <span className="text-slate-500 font-bold">➔ Interlocked with</span>
                    <div className="px-2.5 py-1 bg-teal-500/20 text-teal-300 rounded font-mono text-xs font-bold">
                      LOSSNAY Address {item.lc_address}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveInterlock(item.ic_address)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition"
                    title="Remove Interlock"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-500 text-xs bg-slate-950/40 rounded-xl">
                No active LOSSNAY interlocks configured.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            {interlockMsg ? (
              <div className="text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-xl">
                {interlockMsg}
              </div>
            ) : <div />}
            <button
              onClick={handleSaveInterlocks}
              disabled={isSavingInterlocks}
              className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-teal-900 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSavingInterlocks ? 'Saving...' : 'Save Interlock Matrix to Controller'}
            </button>
          </div>
        </div>
      )}

      {/* Subtab 4: Clock & Summer Time (100% DateTimeSettingsPanel coverage) */}
      {subTab === 'clock' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-400" />
              Real-Time Hardware Clock & Summer Time (DST)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Synchronize the GB-50 clock with local device time or configure automated Daylight Saving Time rules.
            </p>
          </div>

          {/* Clock Sync Banner */}
          <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs uppercase font-bold text-slate-400 block">Current Controller Timestamp</span>
              <div className="text-2xl font-mono font-bold text-blue-400 mt-1">
                {clockTime ? new Date(clockTime).toLocaleString() : 'Fetching...'}
              </div>
              <span className="text-xs text-slate-500 mt-0.5 block">
                Time Master Mode: <strong>Master (GB-50 internal quartz oscillator)</strong>
              </span>
            </div>

            <button
              onClick={handleSyncClock}
              disabled={isSyncingClock}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-900 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingClock ? 'animate-spin' : ''}`} />
              {isSyncingClock ? 'Synchronizing...' : 'Synchronize with Device Clock'}
            </button>
          </div>

          {syncMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-300">
              {syncMessage}
            </div>
          )}

          {/* Summer Time Form */}
          <form onSubmit={handleSaveSummerTime} className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
            <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider">
              Daylight Saving Time (Summer Time) Automation
            </h4>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Country Mode:</label>
                  <select
                    value={summerTimeForm.country_code}
                    onChange={(e) => setSummerTimeForm({ ...summerTimeForm, country_code: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="US0">United States (US0)</option>
                    <option value="EU0">Europe (EU0)</option>
                    <option value="CUSTOM">Custom Rule</option>
                  </select>
                </div>
              </div>

              {/* Start Rule */}
              <div>
                <span className="text-[11px] font-bold text-slate-300 block mb-2">Summer Time Start (DST On):</span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Month (1..12):</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={summerTimeForm.month1}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, month1: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Day/Week:</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={summerTimeForm.day1}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, day1: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Hour (0..23):</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={summerTimeForm.hour1}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, hour1: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Minute (0..59):</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={summerTimeForm.minute1}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, minute1: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Shift Minutes:</label>
                    <input
                      type="number"
                      value={summerTimeForm.shift_min1}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, shift_min1: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* End Rule */}
              <div>
                <span className="text-[11px] font-bold text-slate-300 block mb-2">Summer Time End (DST Off):</span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Month (1..12):</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={summerTimeForm.month2}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, month2: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Day/Week:</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={summerTimeForm.day2}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, day2: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Hour (0..23):</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={summerTimeForm.hour2}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, hour2: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Minute (0..59):</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={summerTimeForm.minute2}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, minute2: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Shift Minutes:</label>
                    <input
                      type="number"
                      value={summerTimeForm.shift_min2}
                      onChange={(e) => setSummerTimeForm({ ...summerTimeForm, shift_min2: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {summerTimeMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-300">
                {summerTimeMsg}
              </div>
            )}

            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition"
            >
              Save Summer Time Rules
            </button>
          </form>
        </div>
      )}

      {/* Subtab 5: Night Setback (100% SetbackSettingsPanel coverage) */}
      {subTab === 'setback' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <Moon className="w-5 h-5 text-indigo-400" />
              Night Setback Temperature Drift Automation
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Maintain indoor zones within unoccupied safety bounds during off-hours to prevent pipe freezes or overheating.
            </p>
          </div>

          <form onSubmit={handleSaveSetback} className="space-y-6">
            <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm text-slate-200 block">Night Setback Function</span>
                  <span className="text-xs text-slate-400">
                    Automatically monitor room drift temperatures during scheduled off-hours.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSetbackForm({ ...setbackForm, enabled: !setbackForm.enabled })}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${
                    setbackForm.enabled
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {setbackForm.enabled ? 'ACTIVE / ENABLED' : 'DISABLED'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-800">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Start Hour (0..23):</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={setbackForm.start_hour}
                    onChange={(e) => setSetbackForm({ ...setbackForm, start_hour: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Start Minute (0..59):</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={setbackForm.start_minute}
                    onChange={(e) => setSetbackForm({ ...setbackForm, start_minute: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">End Hour (0..23):</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={setbackForm.end_hour}
                    onChange={(e) => setSetbackForm({ ...setbackForm, end_hour: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">End Minute (0..59):</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={setbackForm.end_minute}
                    onChange={(e) => setSetbackForm({ ...setbackForm, end_minute: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>
            </div>

            {setbackMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-300">
                {setbackMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSavingSetback}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-900 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSavingSetback ? 'Saving...' : 'Save Setback Automation to Controller'}
            </button>
          </form>
        </div>
      )}

      {/* Subtab 6: Software Licenses (100% OptionSettingsPanel coverage) */}
      {subTab === 'licenses' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Optional Software Function Registration & Licenses
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              View active licensed modules and register new software feature licenses with 16-character keys.
            </p>
          </div>

          {/* License Activation Form */}
          <form onSubmit={handleRegisterLicense} className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
            <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider">
              Register New Software License Key
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Target Feature Module:</label>
                <select
                  value={regFuncIndex}
                  onChange={(e) => setRegFuncIndex(parseInt(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value={1}>1. WebBrowse (Standard Web Access)</option>
                  <option value={2}>2. Schedule (Weekly Automation)</option>
                  <option value={3}>3. Account (Multi-User Accounts)</option>
                  <option value={4}>4. BeforeMal (Predictive Failure)</option>
                  <option value={5}>5. SendMail (Email Fault Dispatch)</option>
                  <option value={6}>6. SaveEnergy (Energy Optimization)</option>
                  <option value={7}>7. MainteTool (Maintenance Tool)</option>
                  <option value={8}>8. UserWeb (End-User Web Pages)</option>
                  <option value={9}>9. Bacnet (BACnet IP Gateway)</option>
                  <option value={10}>10. MainteFull (Full Maintenance)</option>
                  <option value={11}>11. PeakCut (Peak Demand Shaving)</option>
                  <option value={12}>12. PLCIo (PLC Digital I/O)</option>
                  <option value={18}>18. Interlock (Interlock Logic Engine)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">16-Character License Key Code:</label>
                <input
                  type="text"
                  maxLength={16}
                  minLength={16}
                  placeholder="e.g. A1B2C3D4E5F6G7H8"
                  value={regKeyCode}
                  onChange={(e) => setRegKeyCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono tracking-widest"
                  required
                />
              </div>
            </div>

            {licenseMsg && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs font-semibold text-blue-300">
                {licenseMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isRegisteringLicense}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-900 transition disabled:opacity-50"
            >
              {isRegisteringLicense ? 'Registering...' : 'Activate Software License'}
            </button>
          </form>

          {/* Active Inventory Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {systemInfo &&
              Object.entries(systemInfo.licensed_functions).map(([funcName, isEnabled]) => (
                <div
                  key={funcName}
                  className={`p-4 rounded-xl border flex items-center justify-between ${
                    isEnabled
                      ? 'bg-slate-950/90 border-emerald-500/30'
                      : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                  }`}
                >
                  <div>
                    <span className="font-bold text-sm text-slate-100 block">{funcName}</span>
                    <span className="text-[11px] text-slate-400">
                      {isEnabled ? 'Active License' : 'Not Licensed'}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      isEnabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isEnabled ? 'ENABLED' : 'OFF'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Subtab 7: User Security & Role-Based Access Controls (RBAC) */}
      {subTab === 'security' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Key className="w-5 h-5 text-blue-400" />
                Proxy Gateway User Accounts & Role Permissions
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Manage user access accounts, passwords, and assigned roles (Administrator, Operator, Viewer).
              </p>
            </div>

            <button
              onClick={() => setIsCreateUserModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg shadow-blue-900/30"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create New User</span>
            </button>
          </div>

          {userActionMsg && (
            <div className="p-3.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs font-semibold text-blue-300 flex items-center justify-between">
              <span>{userActionMsg}</span>
              <button onClick={() => setUserActionMsg(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* User Accounts Table */}
          <div className="bg-slate-950/80 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 text-slate-400 font-bold border-b border-slate-800 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Permissions</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {proxyUsers.map((u) => {
                  const isAdminUser = u.role === 'admin';
                  const isOperatorUser = u.role === 'operator';
                  const isViewerUser = u.role === 'viewer';

                  return (
                    <tr key={u.id} className="hover:bg-slate-900/50 transition">
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-100 block text-sm">{u.display_name}</span>
                        <span className="text-[11px] text-slate-400 font-mono">@{u.username}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            isAdminUser
                              ? 'bg-blue-600/20 text-blue-300 border-blue-500/30'
                              : isOperatorUser
                              ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-600/20 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {isAdminUser ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : isOperatorUser ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          <span className="capitalize">{u.role}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-xs">
                        {isAdminUser && <span>Full Control, Schedules & Admin</span>}
                        {isOperatorUser && <span>Daily Operations, Setpoints & Presets</span>}
                        {isViewerUser && <span>Read-Only Monitoring</span>}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            u.enabled !== false
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {u.enabled !== false ? 'ACTIVE' : 'DEACTIVATED'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleStartEditUser(u)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
                            title="Edit User or Reset Password"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmUser(u)}
                            className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 rounded-lg transition"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Modal 1: Create New User */}
          {isCreateUserModalOpen && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h4 className="font-bold text-slate-100 flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-blue-400" />
                    Create New Gateway User
                  </h4>
                  <button onClick={() => setIsCreateUserModalOpen(false)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Username:</label>
                    <input
                      type="text"
                      value={newUserForm.username}
                      onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                      placeholder="e.g. jdoe, facility_op"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Display Name:</label>
                    <input
                      type="text"
                      value={newUserForm.display_name}
                      onChange={(e) => setNewUserForm({ ...newUserForm, display_name: e.target.value })}
                      placeholder="e.g. John Doe"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Assigned Role:</label>
                    <select
                      value={newUserForm.role}
                      onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as UserRole })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="operator">Operator (Daily Controls & Presets)</option>
                      <option value="viewer">Viewer (Read-Only Status / Kiosk)</option>
                      <option value="admin">Administrator (Full Access & Schedules)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Initial Password:</label>
                    <input
                      type="password"
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      required
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsCreateUserModalOpen(false)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingUser}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow"
                    >
                      {isSavingUser ? 'Creating...' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 2: Edit User / Reset Password */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h4 className="font-bold text-slate-100 flex items-center gap-2">
                    <Edit2 className="w-4 h-4 text-blue-400" />
                    Edit User: @{editingUser.username}
                  </h4>
                  <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveEditUser} className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Display Name:</label>
                    <input
                      type="text"
                      value={editUserForm.display_name}
                      onChange={(e) => setEditUserForm({ ...editUserForm, display_name: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Assigned Role:</label>
                    <select
                      value={editUserForm.role}
                      onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value as UserRole })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="operator">Operator (Daily Controls & Presets)</option>
                      <option value="viewer">Viewer (Read-Only Status / Kiosk)</option>
                      <option value="admin">Administrator (Full Access & Schedules)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">
                      Reset Password <span className="text-slate-500 font-normal">(leave blank to keep current)</span>:
                    </label>
                    <input
                      type="password"
                      value={editUserForm.new_password}
                      onChange={(e) => setEditUserForm({ ...editUserForm, new_password: e.target.value })}
                      placeholder="New password..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs font-bold text-slate-300">Account Status:</span>
                    <button
                      type="button"
                      onClick={() => setEditUserForm({ ...editUserForm, enabled: !editUserForm.enabled })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold ${
                        editUserForm.enabled
                          ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {editUserForm.enabled ? 'ACTIVE' : 'DEACTIVATED'}
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditingUser(null)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingUser}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow"
                    >
                      {isSavingUser ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 3: Delete Confirmation */}
          {deleteConfirmUser && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-slate-100 text-base">Delete User Account?</h4>
                <p className="text-xs text-slate-400">
                  Are you sure you want to delete user <strong className="text-white">@{deleteConfirmUser.username}</strong> ({deleteConfirmUser.display_name})? This action cannot be undone.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmUser(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteUser}
                    disabled={isSavingUser}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold"
                  >
                    {isSavingUser ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subtab 8: Alarms & Diagnostics */}
      {subTab === 'diagnostics' && (() => {
        const activeCount = alarms.filter((a) => a.is_active).length;
        const resolvedCount = alarms.filter((a) => !a.is_active).length;
        
        // Find most frequent unit
        const addrCounts: Record<string, number> = {};
        alarms.forEach((a) => {
          const key = a.unit_name || `Unit ${a.address}`;
          addrCounts[key] = (addrCounts[key] || 0) + 1;
        });
        const mostAffected = Object.entries(addrCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';

        // Filter list
        const filteredAlarms = alarms.filter((a) => {
          if (alarmFilter === 'active') return a.is_active;
          if (alarmFilter === 'resolved') return !a.is_active;
          if (alarmFilter === 'sensors') return a.category.toLowerCase().includes('sensor') || a.category.toLowerCase().includes('thermistor');
          if (alarmFilter === 'power') return a.category.toLowerCase().includes('power') || a.category.toLowerCase().includes('inverter');
          if (alarmFilter === 'comm') return a.category.toLowerCase().includes('comm') || a.category.toLowerCase().includes('m-net');
          return true;
        });

        return (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            {/* Header */}
            <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                  System Alarms & Mitsubishi Malfunction Diagnostics
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Real-time unit fault monitoring, complete historical logs with start/recovery timestamps, and official Mitsubishi field troubleshooting guides.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={loadAlarms}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
                <button
                  onClick={handleClearAlarmHistory}
                  disabled={isClearingAlarms || alarms.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs font-bold rounded-xl transition disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {isClearingAlarms ? 'Clearing...' : 'Clear Resolved History'}
                </button>
              </div>
            </div>

            {alarmMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-300">
                {alarmMsg}
              </div>
            )}

            {/* Diagnostic Summary Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`p-4 rounded-xl border ${
                activeCount > 0
                  ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                  : 'bg-slate-950/80 border-emerald-500/30 text-emerald-400'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider opacity-80">Active Faults</span>
                  {activeCount > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
                <div className="text-2xl font-extrabold font-mono mt-1">
                  {activeCount > 0 ? `${activeCount} Unresolved` : '0 Active'}
                </div>
                <span className="text-[11px] opacity-70">
                  {activeCount > 0 ? 'Requires technician attention' : 'All systems operating normally'}
                </span>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Logged</span>
                  <Activity className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-extrabold font-mono text-slate-100 mt-1">
                  {alarms.length} Events
                </div>
                <span className="text-[11px] text-slate-400">{resolvedCount} Automatically Resolved</span>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Most Logged Unit</span>
                  <Wrench className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-sm font-bold text-slate-100 mt-1 truncate" title={mostAffected}>
                  {mostAffected}
                </div>
                <span className="text-[11px] text-slate-400">High historical incident rate</span>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-slate-300">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Diagnostic System</span>
                  <Info className="w-4 h-4 text-teal-400" />
                </div>
                <div className="text-sm font-bold text-teal-300 mt-1">
                  City Multi Knowledge Base
                </div>
                <span className="text-[11px] text-slate-400">Official Mitsubishi error codes</span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filter Logs:
              </span>
              {[
                { id: 'all', label: `All Events (${alarms.length})` },
                { id: 'active', label: `Active (${activeCount})` },
                { id: 'resolved', label: `Resolved History (${resolvedCount})` },
                { id: 'sensors', label: 'Sensors & Thermistors' },
                { id: 'power', label: 'Power & Inverter' },
                { id: 'comm', label: 'M-Net Communication' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setAlarmFilter(id as any)}
                  className={`px-3 py-1 rounded-lg border text-xs font-semibold transition ${
                    alarmFilter === id
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Alarms List */}
            {filteredAlarms.length > 0 ? (
              <div className="space-y-4">
                {filteredAlarms.map((alarm) => (
                  <div
                    key={alarm.index}
                    className={`rounded-2xl border p-5 space-y-4 transition ${
                      alarm.is_active
                        ? 'bg-rose-950/30 border-rose-500/60 shadow-lg shadow-rose-950/50'
                        : 'bg-slate-950/70 border-slate-800'
                    }`}
                  >
                    {/* Top Row: Title, Code Pill, and Status Badge */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-base font-extrabold px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          {alarm.error_code}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm text-slate-100">{alarm.title}</h4>
                          <span className="text-[11px] font-semibold text-blue-400">
                            Category: {alarm.category}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {alarm.duration_str && (
                          <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Duration: {alarm.duration_str}
                          </span>
                        )}
                        {alarm.is_active ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-rose-600 text-white flex items-center gap-1 shadow-md animate-pulse">
                            <AlertTriangle className="w-3 h-3" /> ACTIVE FAULT
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> RESOLVED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Unit and Timestamp Details Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-slate-900/60 p-3.5 rounded-xl border border-slate-800/60">
                      <div>
                        <span className="text-slate-500 uppercase font-bold text-[10px] block">Affected Unit</span>
                        <strong className="text-slate-200 block text-xs mt-0.5">
                          {alarm.unit_name || `Address ${alarm.address}`}
                        </strong>
                        <span className="text-[10px] text-slate-400 font-mono">
                          M-Net Addr: {alarm.address} ({alarm.unit_model || 'IC'})
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase font-bold text-[10px] block">Reporting Detector</span>
                        <strong className="text-slate-200 block text-xs mt-0.5">
                          {alarm.detect_name || (alarm.detect_address !== alarm.address ? `Unit ${alarm.detect_address}` : 'Self-Detected')}
                        </strong>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Detect Addr: {alarm.detect_address}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase font-bold text-[10px] block">Fault Occurred</span>
                        <span className="text-slate-300 font-mono text-xs block mt-0.5">
                          {alarm.occurred_at ? new Date(alarm.occurred_at).toLocaleString() : 'Logged Event'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase font-bold text-[10px] block">Fault Cleared / Recovered</span>
                        <span className="text-slate-300 font-mono text-xs block mt-0.5">
                          {alarm.recovered_at ? new Date(alarm.recovered_at).toLocaleString() : 'Currently Active'}
                        </span>
                      </div>
                    </div>

                    {/* Diagnostic Knowledge Base & Troubleshooting Box */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* What Happened */}
                      <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-800">
                        <span className="font-bold text-slate-300 flex items-center gap-1.5 mb-1 text-[11px]">
                          <Info className="w-3.5 h-3.5 text-blue-400" /> Condition Description
                        </span>
                        <p className="text-slate-400 leading-relaxed">{alarm.description}</p>
                      </div>

                      {/* Field Troubleshooting */}
                      <div className="bg-amber-500/10 p-3.5 rounded-xl border border-amber-500/20">
                        <span className="font-bold text-amber-300 flex items-center gap-1.5 mb-1 text-[11px]">
                          <Wrench className="w-3.5 h-3.5 text-amber-400" /> Field Service & Troubleshooting Guide
                        </span>
                        <p className="text-amber-200/90 leading-relaxed">{alarm.troubleshooting}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-slate-950/60 rounded-2xl border border-slate-800">
                <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <h4 className="font-bold text-sm text-slate-200">No Alarms Matching Filter</h4>
                <p className="text-xs text-slate-400 mt-1">No malfunction records match the selected category filter.</p>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};
