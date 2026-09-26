import React, { useState, useEffect, useMemo } from 'react';
import { 
  Cpu, 
  Terminal, 
  Binary, 
  Network, 
  Copy, 
  Check, 
  RefreshCw, 
  Search, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight,
  ShieldCheck,
  Send,
  Loader2
} from 'lucide-react';
import { 
  GroupStatus, 
  SystemInfo, 
  RawBulkGroup, 
  RawScheduleDebugResponse, 
  RawTopologyDebugResponse, 
  RawXmlQueryResult 
} from '../types';
import { 
  fetchRawBulkTelemetry, 
  fetchRawScheduleDebug, 
  fetchRawTopologyDebug, 
  executeRawXmlQuery 
} from '../api';

interface AdminDebugViewProps {
  systemInfo: SystemInfo | null;
  groups: GroupStatus[];
  tempUnit?: 'F' | 'C';
}

type DebugSubTab = 'bulk' | 'schedules' | 'topology' | 'console';

export const AdminDebugView: React.FC<AdminDebugViewProps> = ({
  systemInfo,
  groups,
  tempUnit = 'F',
}) => {
  const [activeTab, setActiveTab] = useState<DebugSubTab>('bulk');

  // Copy state helper: tracks which item ID was just copied
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // =========================================================================
  // Tab 1: 65-Byte Binary Bulk Hex Explorer State
  // =========================================================================
  const [bulkData, setBulkData] = useState<RawBulkGroup[]>([]);
  const [loadingBulk, setLoadingBulk] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number>(groups[0]?.group_id || 1);
  const [byteFilter, setByteFilter] = useState('');

  const loadBulkData = async () => {
    setLoadingBulk(true);
    setBulkError(null);
    try {
      const res = await fetchRawBulkTelemetry();
      setBulkData(res.groups);
      if (res.groups.length > 0 && !res.groups.some(g => g.group_id === selectedGroupId)) {
        setSelectedGroupId(res.groups[0].group_id);
      }
    } catch (err: any) {
      setBulkError(err.message || 'Failed to fetch raw bulk telemetry');
    } finally {
      setLoadingBulk(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'bulk' && bulkData.length === 0) {
      loadBulkData();
    }
  }, [activeTab]);

  const selectedGroupBulk = useMemo(() => {
    return bulkData.find((g) => g.group_id === selectedGroupId) || bulkData[0];
  }, [bulkData, selectedGroupId]);

  const filteredByteAnnotations = useMemo(() => {
    if (!selectedGroupBulk) return [];
    if (!byteFilter) return selectedGroupBulk.byte_annotations;
    const q = byteFilter.toLowerCase();
    return selectedGroupBulk.byte_annotations.filter(
      (b) =>
        b.field.toLowerCase().includes(q) ||
        b.value.toLowerCase().includes(q) ||
        b.hex.toLowerCase().includes(q) ||
        String(b.offset).includes(q) ||
        `0x${b.offset.toString(16)}`.includes(q)
    );
  }, [selectedGroupBulk, byteFilter]);

  // =========================================================================
  // Tab 2: EEPROM Timer Registers State
  // =========================================================================
  const [schedGroupId, setSchedGroupId] = useState<number>(groups[0]?.group_id || 1);
  const [schedSeason, setSchedSeason] = useState<number>(1);
  const [schedData, setSchedData] = useState<RawScheduleDebugResponse | null>(null);
  const [loadingSched, setLoadingSched] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [selectedDayPattern, setSelectedDayPattern] = useState<number>(1);
  const [showRawTodayXml, setShowRawTodayXml] = useState(false);
  const [showRawWeeklyXml, setShowRawWeeklyXml] = useState(false);

  const loadScheduleData = async (gid: number, season: number) => {
    setLoadingSched(true);
    setSchedError(null);
    try {
      const res = await fetchRawScheduleDebug(gid, season);
      setSchedData(res);
    } catch (err: any) {
      setSchedError(err.message || 'Failed to load raw hardware timer registers');
    } finally {
      setLoadingSched(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'schedules') {
      loadScheduleData(schedGroupId, schedSeason);
    }
  }, [activeTab, schedGroupId, schedSeason]);

  // =========================================================================
  // Tab 3: M-NET Topology State
  // =========================================================================
  const [topoData, setTopoData] = useState<RawTopologyDebugResponse | null>(null);
  const [loadingTopo, setLoadingTopo] = useState(false);
  const [topoError, setTopoError] = useState<string | null>(null);
  const [showRawTopoXml, setShowRawTopoXml] = useState(false);

  const loadTopoData = async () => {
    setLoadingTopo(true);
    setTopoError(null);
    try {
      const res = await fetchRawTopologyDebug();
      setTopoData(res);
    } catch (err: any) {
      setTopoError(err.message || 'Failed to load raw topology');
    } finally {
      setLoadingTopo(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'topology' && !topoData) {
      loadTopoData();
    }
  }, [activeTab]);

  // =========================================================================
  // Tab 4: Live Controller XML Protocol Console State
  // =========================================================================
  const [consoleQueryName, setConsoleQueryName] = useState<string>('system_data');
  const [customXmlInput, setCustomXmlInput] = useState<string>('');
  const [consoleGroupId, setConsoleGroupId] = useState<number>(1);
  const [consoleSeason, setConsoleSeason] = useState<number>(1);
  const [queryResult, setQueryResult] = useState<RawXmlQueryResult | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

  const handleExecuteConsoleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExecutingQuery(true);
    try {
      const isCustom = consoleQueryName === 'custom';
      const res = await executeRawXmlQuery(
        isCustom ? undefined : consoleQueryName,
        isCustom ? customXmlInput : undefined,
        consoleGroupId,
        consoleSeason
      );
      setQueryResult(res);
    } catch (err: any) {
      setQueryResult({
        status: 'error',
        request_xml: customXmlInput,
        error: err.message,
        duration_ms: 0,
      });
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="space-y-6">
      {/* Top Banner & Sub-Tabs */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2.5">
              <Cpu className="w-6 h-6 text-indigo-400" />
              Controller Raw Data & Hardware Debug Console
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Direct low-level hardware inspection of the Mitsubishi GB-50 controller memory, 65-byte M-NET binary frames, EEPROM timer registers, and XML socket traffic.
              {systemInfo && (
                <span className="block text-indigo-300 font-mono text-[11px] mt-1">
                  Target: {systemInfo.system_name || 'GB-50'} ({systemInfo.model}) • Firmware v{systemInfo.version} • IP {systemInfo.ip_address}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-xs font-mono font-bold rounded-lg flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              Admin Privilege Active
            </span>
          </div>
        </div>

        {/* View Mode Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('bulk')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === 'bulk'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Binary className="w-4 h-4" />
            65-Byte Bulk Hex Explorer
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schedules')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === 'schedules'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Calendar className="w-4 h-4" />
            EEPROM Timer Registers
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('topology')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === 'topology'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Network className="w-4 h-4" />
            M-NET Topology & Bus
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('console')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === 'console'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Terminal className="w-4 h-4" />
            Live XML Protocol Console
          </button>
        </div>
      </div>

      {/* TAB 1: 65-BYTE BINARY BULK HEX EXPLORER */}
      {activeTab === 'bulk' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Select Zone:</span>
              <div className="relative">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
                >
                  {bulkData.map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      [{g.group_id}] {g.name} ({g.model}) — M-NET Addr {g.address}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter byte fields..."
                  value={byteFilter}
                  onChange={(e) => setByteFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-48"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadBulkData}
                disabled={loadingBulk}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingBulk ? 'animate-spin' : ''}`} />
                Refresh Telemetry
              </button>
            </div>
          </div>

          {bulkError && (
            <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-2xl text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{bulkError}</span>
            </div>
          )}

          {selectedGroupBulk && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Formatted Memory Hex Dump (5 cols) */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Binary className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-sm text-slate-200">Raw Hex Dump (65 Bytes)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy('bulk_hex', selectedGroupBulk.raw_hex)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-indigo-300 transition cursor-pointer"
                    >
                      {copiedId === 'bulk_hex' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === 'bulk_hex' ? 'Copied' : 'Copy Hex'}
                    </button>
                  </div>

                  <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto select-all">
                    <div className="text-slate-600 pb-1 text-[10px] tracking-wider uppercase border-b border-slate-900 mb-1">
                      Offset  00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F   ASCII
                    </div>
                    {selectedGroupBulk.hex_dump.map((row) => (
                      <div key={row.offset} className="flex items-center gap-3 hover:bg-indigo-950/30 px-1 rounded">
                        <span className="text-indigo-400 font-bold">{row.offset}</span>
                        <span className="text-emerald-300">{row.hex}</span>
                        <span className="text-slate-500 select-none">|{row.ascii}|</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                      Continuous Hex Payload ({selectedGroupBulk.raw_hex.length} characters):
                    </span>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 font-mono text-[10px] text-slate-400 break-all select-all">
                      {selectedGroupBulk.raw_hex}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-400 block border-b border-slate-800 pb-2">
                    Decoded Controller States
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Power Drive</span>
                      <span className="font-bold text-slate-200">{selectedGroupBulk.parsed_fields.drive || 'OFF'}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Operation Mode</span>
                      <span className="font-bold text-slate-200">{selectedGroupBulk.parsed_fields.mode || 'AUTO'}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Set Temp</span>
                      <span className="font-bold text-indigo-300">
                        {selectedGroupBulk.parsed_fields.set_temp_c != null ? `${selectedGroupBulk.parsed_fields.set_temp_c}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Inlet Thermistor</span>
                      <span className="font-bold text-emerald-300">
                        {selectedGroupBulk.parsed_fields.inlet_temp_c != null ? `${selectedGroupBulk.parsed_fields.inlet_temp_c}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Remote Lock</span>
                      <span className="font-bold text-slate-200">{selectedGroupBulk.parsed_fields.remote_lock || 'PERMIT'}</span>
                    </div>
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-slate-500 block text-[10px] uppercase">Filter Sign</span>
                      <span className={`font-bold ${selectedGroupBulk.parsed_fields.filter_dirty ? 'text-amber-400' : 'text-slate-400'}`}>
                        {selectedGroupBulk.parsed_fields.filter_dirty ? 'DIRTY' : 'CLEAN'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Byte-by-Byte Breakdown Table (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-200">Byte-by-Byte Protocol Dissector</h3>
                    <p className="text-[11px] text-slate-400">
                      Showing {filteredByteAnnotations.length} annotated register bytes for [{selectedGroupBulk.group_id}] {selectedGroupBulk.name}
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/80 px-2.5 py-1 rounded-lg border border-indigo-500/30">
                    Byte 0..64
                  </span>
                </div>

                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950/80 sticky top-0 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      <tr>
                        <th className="py-2 px-2.5">Offset</th>
                        <th className="py-2 px-2.5">Hex</th>
                        <th className="py-2 px-2.5">Dec</th>
                        <th className="py-2 px-3">Protocol Field Name</th>
                        <th className="py-2 px-3">Decoded Interpretation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {filteredByteAnnotations.map((b) => {
                        const isHeader = b.offset === 0;
                        const isPrimary = [1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 21].includes(b.offset);
                        return (
                          <tr
                            key={b.offset}
                            className={`transition hover:bg-indigo-950/30 ${
                              isPrimary ? 'bg-slate-800/20 text-slate-100 font-semibold' : 'text-slate-400'
                            }`}
                          >
                            <td className="py-1.5 px-2.5 text-indigo-400 font-bold">
                              {b.offset} <span className="text-[10px] text-slate-600">(0x{b.offset.toString(16).padStart(2, '0')})</span>
                            </td>
                            <td className="py-1.5 px-2.5 text-emerald-300 font-bold">{b.hex}</td>
                            <td className="py-1.5 px-2.5 text-slate-400">{b.dec}</td>
                            <td className="py-1.5 px-3 font-sans text-slate-200">{b.field}</td>
                            <td className="py-1.5 px-3 text-slate-300">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-sans font-medium ${
                                  isHeader
                                    ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                                    : isPrimary
                                    ? 'bg-slate-800 text-indigo-200 border border-slate-700'
                                    : 'text-slate-400'
                                }`}
                              >
                                {b.value}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: EEPROM TIMER REGISTERS */}
      {activeTab === 'schedules' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Inspect Zone:</span>
              <select
                value={schedGroupId}
                onChange={(e) => setSchedGroupId(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
              >
                {groups.map((g) => (
                  <option key={g.group_id} value={g.group_id}>
                    [{g.group_id}] {g.name}
                  </option>
                ))}
              </select>

              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-2">Season:</span>
              <select
                value={schedSeason}
                onChange={(e) => setSchedSeason(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
              >
                <option value={1}>Season 1 (Default / Summer)</option>
                <option value={2}>Season 2 (Winter)</option>
                <option value={3}>Season 3 (Spring)</option>
                <option value={4}>Season 4 (Fall)</option>
                <option value={5}>Season 5 (Special)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => loadScheduleData(schedGroupId, schedSeason)}
              disabled={loadingSched}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSched ? 'animate-spin' : ''}`} />
              Query Hardware Registers
            </button>
          </div>

          {schedError && (
            <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-2xl text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{schedError}</span>
            </div>
          )}

          {schedData && (
            <div className="space-y-6">
              {/* SECTION A: TodayList */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-400" />
                      TodayList Daily Execution Registers (Active in Controller RAM)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Hardware timer slots 1..16 currently active for today's operational cycle.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRawTodayXml(!showRawTodayXml)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    {showRawTodayXml ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {showRawTodayXml ? 'Hide XML' : 'View Raw XML'}
                  </button>
                </div>

                {showRawTodayXml && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-2">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase border-b border-slate-900 pb-1">
                      <span>Controller XML Response</span>
                      <button
                        type="button"
                        onClick={() => handleCopy('today_xml', schedData.today_response_xml)}
                        className="hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'today_xml' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap select-all">{schedData.today_response_xml}</pre>
                  </div>
                )}

                {schedData.today_records.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-xs italic bg-slate-950/50 rounded-xl border border-slate-800/50">
                    No active timer events configured in TodayList registers for this zone.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {schedData.today_records.map((rec) => (
                      <div key={rec.index} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-indigo-400 font-bold">Slot #{rec.index}</span>
                          <span className="font-mono text-slate-200 font-extrabold text-sm">
                            {String(rec.hour).padStart(2, '0')}:{String(rec.minute).padStart(2, '0')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              rec.drive === 'ON' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {rec.drive}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                            {rec.mode || 'AUTO'}
                          </span>
                          {rec.set_temp_c != null && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                              {tempUnit === 'F' ? `${Math.round(rec.set_temp_c * 1.8 + 32)}°F` : `${rec.set_temp_c}°C`}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION B: WPatternList */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      WPatternList EEPROM Weekly Schedule Registers (Season {schedSeason})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      7-day recurring schedule patterns flashed into controller non-volatile EEPROM memory.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRawWeeklyXml(!showRawWeeklyXml)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold self-start sm:self-auto cursor-pointer"
                  >
                    {showRawWeeklyXml ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {showRawWeeklyXml ? 'Hide XML' : 'View Raw XML'}
                  </button>
                </div>

                {showRawWeeklyXml && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-2">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase border-b border-slate-900 pb-1">
                      <span>Controller XML Response</span>
                      <button
                        type="button"
                        onClick={() => handleCopy('weekly_xml', schedData.weekly_response_xml)}
                        className="hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === 'weekly_xml' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap select-all">{schedData.weekly_response_xml}</pre>
                  </div>
                )}

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((dayNum) => {
                    const count = schedData.weekly_patterns[String(dayNum)]?.length || 0;
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        onClick={() => setSelectedDayPattern(dayNum)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                          selectedDayPattern === dayNum
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {dayNames[dayNum]} ({count})
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const dayEvents = schedData.weekly_patterns[String(selectedDayPattern)] || [];
                  if (dayEvents.length === 0) {
                    return (
                      <div className="text-center py-6 text-slate-500 text-xs italic bg-slate-950/50 rounded-xl border border-slate-800/50">
                        No weekly timer registers programmed on {dayNames[selectedDayPattern]} for Season {schedSeason}.
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      {dayEvents.map((rec) => (
                        <div key={rec.index} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono text-indigo-400 font-bold">Register #{rec.index}</span>
                            <span className="font-mono text-slate-200 font-extrabold text-sm">
                              {String(rec.hour).padStart(2, '0')}:{String(rec.minute).padStart(2, '0')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                rec.drive === 'ON' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {rec.drive}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                              {rec.mode || 'AUTO'}
                            </span>
                            {rec.set_temp_c != null && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                                {tempUnit === 'F' ? `${Math.round(rec.set_temp_c * 1.8 + 32)}°F` : `${rec.set_temp_c}°C`}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: M-NET TOPOLOGY & ADDRESS BUS */}
      {activeTab === 'topology' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <Network className="w-4 h-4 text-indigo-400" />
                Raw M-NET Bus Topology & Address Mapping
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Hardware records parsed from the controller's internal <code className="text-indigo-300">&lt;ControlGroup&gt;</code> database.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRawTopoXml(!showRawTopoXml)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer"
              >
                {showRawTopoXml ? 'Hide XML' : 'View Raw XML'}
              </button>
              <button
                type="button"
                onClick={loadTopoData}
                disabled={loadingTopo}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTopo ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {topoError && (
            <div className="p-4 bg-rose-950/40 border border-rose-500/50 rounded-2xl text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{topoError}</span>
            </div>
          )}

          {showRawTopoXml && topoData && (
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-xs text-slate-300 space-y-2">
              <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase border-b border-slate-900 pb-1">
                <span>&lt;ControlGroup&gt; Response XML</span>
                <button
                  type="button"
                  onClick={() => handleCopy('topo_xml', topoData.response_xml)}
                  className="hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                >
                  {copiedId === 'topo_xml' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  Copy
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap select-all">{topoData.response_xml}</pre>
            </div>
          )}

          {topoData && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Configured Groups</span>
                  <div className="text-2xl font-extrabold text-slate-100 mt-1 font-mono">
                    {Object.keys(topoData.topology).length}
                  </div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Assigned Addresses</span>
                  <div className="text-2xl font-extrabold text-indigo-400 mt-1 font-mono">
                    {topoData.assigned_addresses.length}
                  </div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Unassigned Slots</span>
                  <div className="text-2xl font-extrabold text-slate-400 mt-1 font-mono">
                    {topoData.unassigned_addresses.length}
                  </div>
                </div>
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Lossnay Interlocks</span>
                  <div className="text-2xl font-extrabold text-emerald-400 mt-1 font-mono">
                    {topoData.interlocks.length}
                  </div>
                </div>
              </div>

              {/* 50-Address Visual Bus Map */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    M-NET Physical Bus Address Grid (1..50)
                  </span>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-blue-300">
                      <span className="w-2.5 h-2.5 rounded bg-blue-600 inline-block" /> Primary IC
                    </span>
                    <span className="flex items-center gap-1 text-purple-300">
                      <span className="w-2.5 h-2.5 rounded bg-purple-600 inline-block" /> Lossnay LC
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <span className="w-2.5 h-2.5 rounded bg-slate-800 inline-block" /> Unassigned
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-10 gap-1.5 font-mono text-[11px]">
                  {Array.from({ length: 50 }, (_, i) => i + 1).map((addr) => {
                    let role = 'unassigned';
                    let label = `${addr}`;
                    for (const [gid, meta] of Object.entries(topoData.topology)) {
                      if (meta.address === addr) {
                        role = meta.model === 'LC' ? 'lossnay' : 'primary';
                        label = `[${gid}] ${addr}`;
                        break;
                      } else if (meta.slaves?.includes(addr)) {
                        role = 'slave';
                        label = `S:${addr}`;
                        break;
                      } else if (meta.rcs?.includes(addr)) {
                        role = 'rc';
                        label = `RC:${addr}`;
                        break;
                      }
                    }

                    return (
                      <div
                        key={addr}
                        title={`Address ${addr}: ${role}`}
                        className={`p-1.5 rounded-lg text-center font-bold transition ${
                          role === 'primary'
                            ? 'bg-blue-600 text-white'
                            : role === 'lossnay'
                            ? 'bg-purple-600 text-white'
                            : role === 'slave'
                            ? 'bg-cyan-700 text-white'
                            : role === 'rc'
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-950 text-slate-600 border border-slate-800'
                        }`}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Group Hardware Mapping Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-300 block border-b border-slate-800 pb-2">
                  Group Hardware Registry Table
                </span>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400">
                      <tr>
                        <th className="py-2 px-3">Group ID</th>
                        <th className="py-2 px-3">Controller Name</th>
                        <th className="py-2 px-3">Model</th>
                        <th className="py-2 px-3">Primary M-NET Address</th>
                        <th className="py-2 px-3">Slaves</th>
                        <th className="py-2 px-3">Remotes (RC)</th>
                        <th className="py-2 px-3">Lossnay Interlock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {Object.entries(topoData.topology).map(([gid, meta]) => (
                        <tr key={gid} className="hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-bold text-indigo-400">#{gid}</td>
                          <td className="py-2 px-3 font-sans text-slate-200 font-semibold">{meta.name}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                meta.model === 'LC' ? 'bg-purple-950 text-purple-300 border border-purple-500/30' : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {meta.model}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-200 font-bold">{meta.address}</td>
                          <td className="py-2 px-3 text-slate-400">
                            {meta.slaves?.length > 0 ? meta.slaves.join(', ') : 'None'}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {meta.rcs?.length > 0 ? meta.rcs.join(', ') : 'None'}
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {meta.interlocked_lossnay_address ? (
                              <span className="text-emerald-400 font-bold">LC Addr {meta.interlocked_lossnay_address}</span>
                            ) : (
                              <span className="text-slate-600">None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE CONTROLLER XML PROTOCOL CONSOLE */}
      {activeTab === 'console' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                Live XML Protocol Query Inspector
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Execute safe read queries directly against the controller's <code className="text-indigo-300">/servlet/MIMEReceiveServlet</code> and view the exact XML exchanged over the wire with round-trip latency.
              </p>
            </div>

            <form onSubmit={handleExecuteConsoleQuery} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Query Type:
                  </label>
                  <select
                    value={consoleQueryName}
                    onChange={(e) => setConsoleQueryName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
                  >
                    <option value="system_data">&lt;SystemData&gt; & &lt;FunctionControl&gt;</option>
                    <option value="topology">&lt;ControlGroup&gt; (Hardware Topology)</option>
                    <option value="telemetry">&lt;Mnet&gt; Telemetry (All 50 Zones)</option>
                    <option value="today_schedule">&lt;TodayList&gt; Daily Schedule Timers</option>
                    <option value="weekly_schedule">&lt;WPatternList&gt; Weekly Schedule Patterns</option>
                    <option value="seasons">&lt;WSeasonList&gt; 5 Seasons Calendar</option>
                    <option value="alarms">&lt;AlarmList&gt; Malfunction History</option>
                    <option value="datetime">&lt;DateTime&gt; Hardware Real-Time Clock</option>
                    <option value="summertime">&lt;SummerTime&gt; Daylight Saving Settings</option>
                    <option value="setback">&lt;SetbackControl&gt; Night Setback</option>
                    <option value="custom">Custom Safe Read XML Query</option>
                  </select>
                </div>

                {(consoleQueryName === 'today_schedule' || consoleQueryName === 'weekly_schedule') && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Target Zone:
                    </label>
                    <select
                      value={consoleGroupId}
                      onChange={(e) => setConsoleGroupId(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
                    >
                      {groups.map((g) => (
                        <option key={g.group_id} value={g.group_id}>
                          [{g.group_id}] {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {consoleQueryName === 'weekly_schedule' && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Target Season:
                    </label>
                    <select
                      value={consoleSeason}
                      onChange={(e) => setConsoleSeason(Number(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-none focus:border-indigo-500"
                    >
                      <option value={1}>Season 1</option>
                      <option value={2}>Season 2</option>
                      <option value={3}>Season 3</option>
                      <option value={4}>Season 4</option>
                      <option value={5}>Season 5</option>
                    </select>
                  </div>
                )}
              </div>

              {consoleQueryName === 'custom' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-bold uppercase tracking-wider text-slate-400">
                      Custom Read XML Body:
                    </label>
                    <span className="text-[11px] text-amber-400 flex items-center gap-1 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Read-only queries only (mutations rejected)
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    value={customXmlInput}
                    onChange={(e) => setCustomXmlInput(e.target.value)}
                    placeholder='<SystemData /> or <ControlGroup />'
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isExecutingQuery}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 cursor-pointer"
                >
                  {isExecutingQuery ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Querying Hardware...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send XML Query
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Results Display Panel */}
          {queryResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                      queryResult.status === 'success'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-950 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    {queryResult.status === 'success' ? '200 OK — Success' : 'Error'}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Round-Trip Latency: <strong className="text-indigo-400">{queryResult.duration_ms} ms</strong>
                  </span>
                </div>
              </div>

              {queryResult.error && (
                <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300">
                  {queryResult.error}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                      Outgoing HTTP POST Payload
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('req_xml', queryResult.request_xml)}
                      className="hover:text-indigo-400 text-[11px] flex items-center gap-1 font-semibold text-slate-400 cursor-pointer"
                    >
                      {copiedId === 'req_xml' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      Copy
                    </button>
                  </div>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-indigo-300 font-mono text-xs overflow-x-auto max-h-96 select-all">
                    {queryResult.request_xml}
                  </pre>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                      Controller Response XML Body
                    </span>
                    {queryResult.response_xml && (
                      <button
                        type="button"
                        onClick={() => handleCopy('resp_xml', queryResult.response_xml || '')}
                        className="hover:text-indigo-400 text-[11px] flex items-center gap-1 font-semibold text-slate-400 cursor-pointer"
                      >
                        {copiedId === 'resp_xml' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Copy
                      </button>
                    )}
                  </div>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-emerald-300 font-mono text-xs overflow-x-auto max-h-96 select-all">
                    {queryResult.response_xml || 'No response XML payload returned.'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
