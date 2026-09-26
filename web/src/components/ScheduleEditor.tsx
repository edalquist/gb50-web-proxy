import React, { useState, useMemo } from 'react';
import { GroupStatus, ScheduleProgram, SeasonConfig, OperationMode } from '../types';
import { 
  compactSpaceSummary, 
  formatDaysSummary, 
  groupSpacesByArea,
  getRoomDisplayName,
  parseTime12,
  formatTime12 
} from '../utils/scheduleHelpers';
import { MiniTimelineBar } from './MiniTimelineBar';

interface ScheduleEditorProps {
  initialSchedule?: ScheduleProgram | null;
  groups: GroupStatus[];
  seasons: SeasonConfig[];
  tempUnit: 'F' | 'C';
  onSaveDraft: (data: any) => Promise<void>;
  onProceedToReview: (data: any) => void;
  onCancel: () => void;
}

const DAYS_ORDER = [
  { id: 7, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
  initialSchedule,
  groups,
  seasons,
  tempUnit,
  onSaveDraft,
  onProceedToReview,
  onCancel,
}) => {
  const meta = initialSchedule?.metadata_json || {};

  // Form State
  const [name, setName] = useState(initialSchedule?.name || '');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>(
    initialSchedule?.assigned_group_ids && initialSchedule.assigned_group_ids.length > 0
      ? initialSchedule.assigned_group_ids
      : []
  );
  const [selectedDays, setSelectedDays] = useState<number[]>(
    meta.days && meta.days.length > 0 ? meta.days : [1, 2, 3, 4, 5]
  );
  
  // Seasons map & selection
  const seasonMap = useMemo(() => new Map(seasons.map(s => [s.season_id, s])), [seasons]);
  const [selectedSeasonOption, setSelectedSeasonOption] = useState<string>(() => {
    if (initialSchedule?.season_id) return String(initialSchedule.season_id);
    if (meta.start_date && meta.end_date && (meta.start_date !== 'Jan 1' || meta.end_date !== 'Dec 31')) {
      return 'custom';
    }
    return 'year_round';
  });

  const [startDateStr, setStartDateStr] = useState<string>(meta.start_date || 'Jan 1');
  const [endDateStr, setEndDateStr] = useState<string>(meta.end_date || 'Dec 31');

  const handleSeasonChange = (optionVal: string) => {
    setSelectedSeasonOption(optionVal);
    if (optionVal === 'year_round') {
      setStartDateStr('Jan 1');
      setEndDateStr('Dec 31');
    } else if (optionVal !== 'custom') {
      const s = seasonMap.get(Number(optionVal));
      if (s) {
        const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        setStartDateStr(`${monthNames[s.start_month] || s.start_month} ${s.start_day}`);
        setEndDateStr(`${monthNames[s.end_month] || s.end_month} ${s.end_day}`);
      }
    }
  };
  
  // Occupied Time
  const [startsInput, setStartsInput] = useState<string>(
    meta.occupied_start ? formatTime12(meta.occupied_start) : '08:00 AM'
  );
  const [endsInput, setEndsInput] = useState<string>(
    meta.occupied_end ? formatTime12(meta.occupied_end) : '05:00 PM'
  );

  const durationText = useMemo(() => {
    const s24 = parseTime12(startsInput);
    const e24 = parseTime12(endsInput);
    const [sH, sM] = s24.split(':').map(Number);
    const [eH, eM] = e24.split(':').map(Number);
    const diff = (eH * 60 + eM) - (sH * 60 + sM);
    if (diff <= 0) return null;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m` : ''}`.trim();
  }, [startsInput, endsInput]);

  // Comfort
  const [temperatureVal, setTemperatureVal] = useState<number>(() => {
    if (tempUnit === 'C') {
      return meta.temperature_f ? Math.round((meta.temperature_f - 32) * 5 / 9) : 21;
    }
    return meta.temperature_f || 70;
  });
  const [operationMode, setOperationMode] = useState<OperationMode>(meta.mode || 'AUTO');
  const [thermostatAllowed, setThermostatAllowed] = useState<boolean>(
    meta.thermostat_adjustments_allowed !== undefined ? meta.thermostat_adjustments_allowed : true
  );

  const tempOptions = useMemo(() => {
    if (tempUnit === 'C') {
      return Array.from({ length: 14 }, (_, i) => 16 + i); // 16°C to 29°C
    }
    return Array.from({ length: 25 }, (_, i) => 60 + i); // 60°F to 84°F
  }, [tempUnit]);

  // Space Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyShowSelected, setOnlyShowSelected] = useState(false);
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Space Grouping
  const areaGroups = useMemo(() => groupSpacesByArea(groups), [groups]);
  const allGroupIds = useMemo(() => groups.map(g => g.group_id), [groups]);

  const toggleDay = (dayId: number) => {
    setSelectedDays(prev => 
      prev.includes(dayId) ? prev.filter(d => d !== dayId) : [...prev, dayId].sort()
    );
  };

  const toggleSpace = (id: number) => {
    setSelectedGroupIds(prev => 
      prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]
    );
  };

  const toggleArea = (areaGroupIds: number[]) => {
    const allSelected = areaGroupIds.every(id => selectedGroupIds.includes(id));
    if (allSelected) {
      setSelectedGroupIds(prev => prev.filter(id => !areaGroupIds.includes(id)));
    } else {
      setSelectedGroupIds(prev => Array.from(new Set([...prev, ...areaGroupIds])));
    }
  };

  const spaceSummary = useMemo(() => {
    return compactSpaceSummary(selectedGroupIds, groups);
  }, [selectedGroupIds, groups]);

  const daysSummary = useMemo(() => {
    return formatDaysSummary(selectedDays);
  }, [selectedDays]);

  const getPayload = () => {
    const parsedStart = parseTime12(startsInput);
    const parsedEnd = parseTime12(endsInput);
    const chosenSeasonId = selectedSeasonOption !== 'year_round' && selectedSeasonOption !== 'custom' 
      ? Number(selectedSeasonOption) 
      : undefined;

    return {
      id: initialSchedule?.id,
      name: name.trim() || 'New Schedule',
      room_ids: selectedGroupIds,
      days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5],
      recurrence_kind: 'weekly',
      season_id: chosenSeasonId,
      start_date: startDateStr,
      end_date: endDateStr,
      occupied_start: parsedStart,
      occupied_end: parsedEnd,
      temperature_f: tempUnit === 'C' ? Math.round((temperatureVal * 9 / 5) + 32) : temperatureVal,
      mode: operationMode,
      thermostat_adjustments_allowed: thermostatAllowed,
    };
  };

  const handleProceedClick = () => {
    if (!name.trim()) {
      setValidationError('Please enter a schedule name before continuing.');
      return;
    }
    if (selectedGroupIds.length === 0) {
      setValidationError('Please select at least one space before continuing.');
      return;
    }
    if (selectedDays.length === 0) {
      setValidationError('Please select at least one day for this schedule.');
      return;
    }
    const s24 = parseTime12(startsInput);
    const e24 = parseTime12(endsInput);
    if (s24 >= e24) {
      setValidationError('Ending time must be later than starting time.');
      return;
    }
    setValidationError(null);
    onProceedToReview(getPayload());
  };

  const handleSaveAndClose = async () => {
    await onSaveDraft(getPayload());
    onCancel();
  };

  return (
    <section id="create" className="screen active">
      <div className="page-head">
        <div>
          <div className="eyebrow">New schedule</div>
          <h1>Plan around occupied hours</h1>
          <p className="subtle">Tell us when spaces are in use. The system will handle the controller settings.</p>
        </div>
        <button type="button" className="quiet" onClick={() => setShowDiscardGuard(true)}>
          Save and close
        </button>
      </div>

      <div className="editor-layout">
        <div className="form-card">
          {/* 1. Schedule Name */}
          <div>
            <div className="section-title">
              <span className="num">1</span>
              <div>
                <h3>What is this for?</h3>
                <p className="subtle">Use a name staff will recognize on the operating calendar.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="name">Schedule name</label>
              <input
                id="name"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="e.g. Sunday Worship, Staff Meeting, or Office Hours"
              />
            </div>
          </div>

          {/* 2. Spaces */}
          <div>
            <div className="section-title">
              <span className="num">2</span>
              <div>
                <h3>Which spaces should be comfortable?</h3>
                <p className="subtle">Select 1–30 spaces. Equipment and fresh-air systems are selected automatically.</p>
              </div>
            </div>
            <div className="field">
              <div className="space-tools">
                <input
                  id="space-search"
                  aria-label="Search spaces"
                  placeholder="Search spaces by name…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="selection-bar">
                <strong id="selection-count">
                  {selectedGroupIds.length} {selectedGroupIds.length === 1 ? 'space' : 'spaces'} selected
                </strong>
                <span>
                  <button
                    type="button"
                    onClick={() => setSelectedGroupIds(allGroupIds)}
                    style={{ color: '#9db8ff', background: 'transparent', border: 0, cursor: 'pointer', fontSize: '12px' }}
                  >
                    Select all ({allGroupIds.length})
                  </button>
                  {' · '}
                  <button
                    type="button"
                    id="show-selected"
                    onClick={() => setOnlyShowSelected(!onlyShowSelected)}
                    style={{ color: '#9db8ff', background: 'transparent', border: 0, cursor: 'pointer', fontSize: '12px' }}
                  >
                    {onlyShowSelected ? 'Show all spaces' : 'Only show selected'}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    id="clear-spaces"
                    onClick={() => setSelectedGroupIds([])}
                    style={{ color: '#9db8ff', background: 'transparent', border: 0, cursor: 'pointer', fontSize: '12px' }}
                  >
                    Clear
                  </button>
                </span>
              </div>

              <div id="space-list" className="space-list" aria-label="Spaces grouped by area">
                {areaGroups.map(area => {
                  const query = searchQuery.trim().toLowerCase();
                  const visible = area.groups.filter(g => {
                    const roomName = getRoomDisplayName(g).toLowerCase();
                    return (!query || roomName.includes(query)) && (!onlyShowSelected || selectedGroupIds.includes(g.group_id));
                  });

                  if (!visible.length) return null;
                  const selectedInArea = area.groups.filter(g => selectedGroupIds.includes(g.group_id)).length;
                  const areaGroupIds = area.groups.map(g => g.group_id);

                  return (
                    <section key={area.name} className="area">
                      <div className="area-head">
                        <span>
                          {area.name}
                          <small>{selectedInArea} of {area.groups.length} selected</small>
                        </span>
                        <button type="button" onClick={() => toggleArea(areaGroupIds)}>
                          {selectedInArea === area.groups.length ? 'Clear area' : 'Select area'}
                        </button>
                      </div>
                      <div className="room-grid">
                        {visible.map(g => {
                          const isChecked = selectedGroupIds.includes(g.group_id);
                          return (
                            <label
                              key={g.group_id}
                              className={`room ${isChecked ? 'checked' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSpace(g.group_id)}
                              />
                              {' '}{getRoomDisplayName(g)}
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Repeats */}
          <div>
            <div className="section-title">
              <span className="num">3</span>
              <div>
                <h3>When does it repeat?</h3>
                <p className="subtle">Choose one or more days.</p>
              </div>
            </div>
            <div className="field">
              <div className="days" aria-label="Days of week">
                {DAYS_ORDER.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={`day ${selectedDays.includes(d.id) ? 'selected' : ''}`}
                    onClick={() => toggleDay(d.id)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: '14px' }}>
                <label htmlFor="season-select">Active Season</label>
                <select
                  id="season-select"
                  value={selectedSeasonOption}
                  onChange={e => handleSeasonChange(e.target.value)}
                >
                  <option value="year_round">Year-round (Jan 1 – Dec 31)</option>
                  {seasons.map(s => (
                    <option key={s.season_id} value={String(s.season_id)}>
                      {s.name} ({s.start_month}/{s.start_day}–{s.end_month}/{s.end_day})
                    </option>
                  ))}
                  <option value="custom">Custom Date Window</option>
                </select>
              </div>

              {selectedSeasonOption === 'custom' && (
                <div className="inline" style={{ marginTop: '12px' }}>
                  <div>
                    <label htmlFor="starts-date">Starting</label>
                    <input
                      id="starts-date"
                      type="text"
                      value={startDateStr}
                      onChange={e => setStartDateStr(e.target.value)}
                      placeholder="e.g. Apr 1"
                    />
                  </div>
                  <div>
                    <label htmlFor="ends-date">Ending</label>
                    <input
                      id="ends-date"
                      type="text"
                      value={endDateStr}
                      onChange={e => setEndDateStr(e.target.value)}
                      placeholder="e.g. Sep 30"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Occupied Hours */}
          <div>
            <div className="section-title">
              <span className="num">4</span>
              <div>
                <h3>When will people use the rooms?</h3>
                <p className="subtle">HVAC will turn off automatically at the end.</p>
              </div>
            </div>
            <div className="field">
              <div className="inline">
                <div>
                  <label htmlFor="starts">Starts</label>
                  <input
                    id="starts"
                    value={startsInput}
                    onChange={e => setStartsInput(e.target.value)}
                    placeholder="e.g. 8:00 AM"
                  />
                </div>
                <div>
                  <label htmlFor="ends">Ends</label>
                  <input
                    id="ends"
                    value={endsInput}
                    onChange={e => setEndsInput(e.target.value)}
                    placeholder="e.g. 5:00 PM"
                  />
                </div>
              </div>
              {durationText && (
                <p className="hint">Occupied for ~{durationText} each scheduled day.</p>
              )}

              {/* Live 24-Hour Cycle Preview */}
              <div style={{ marginTop: '14px', background: '#0b1120', padding: '12px 14px', borderRadius: '8px', border: '1px solid #1f2a44' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8aa0c6', fontWeight: 600 }}>
                    24-Hour Schedule Footprint
                  </span>
                  <span style={{ fontSize: '11px', color: '#49d6a2', fontWeight: 600 }}>
                    Live Preview
                  </span>
                </div>
                <MiniTimelineBar
                  occupiedStart={parseTime12(startsInput)}
                  occupiedEnd={parseTime12(endsInput)}
                  temperatureF={tempUnit === 'C' ? Math.round((temperatureVal * 9 / 5) + 32) : temperatureVal}
                  tempUnit={tempUnit}
                  mode={operationMode}
                />
              </div>
            </div>
          </div>

          {/* 5. Temperature */}
          <div>
            <div className="section-title">
              <span className="num">5</span>
              <div>
                <h3>Choose a comfortable temperature</h3>
                <p className="subtle">Auto mode will heat or cool as needed.</p>
              </div>
            </div>
            <div className="field">
              <label htmlFor="temperature">Temperature</label>
              <select
                id="temperature"
                value={temperatureVal}
                onChange={e => setTemperatureVal(Number(e.target.value))}
              >
                {tempOptions.map(t => (
                  <option key={t} value={t}>{t}°{tempUnit}</option>
                ))}
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={thermostatAllowed}
                  onChange={e => setThermostatAllowed(e.target.checked)}
                  style={{ width: 'auto', accentColor: 'var(--blue)' }}
                />
                <span style={{ fontSize: '13px', color: '#c8d1e2' }}>
                  Allow room thermostat adjustments (within ±2°F) during occupied hours
                </span>
              </label>
            </div>
          </div>

          {/* Facilities & Hardware Parameters (Collapsible Accordion) */}
          <details className="facilities-drawer" style={{
            marginTop: '8px',
            background: '#0a101d',
            border: '1px solid #22314e',
            borderRadius: '10px',
            padding: '14px 16px'
          }}>
            <summary style={{
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              color: '#9db8ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              userSelect: 'none'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⚙</span>
                <span>Facilities &amp; Controller Registers (Advanced)</span>
              </span>
              <span style={{ fontSize: '11px', color: '#6882a9' }}>EEPROM &amp; Remote Lockout Options</span>
            </summary>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid #1a253c', paddingTop: '14px' }}>
              <div>
                <label htmlFor="operation-mode" style={{ fontSize: '12px', color: '#c8d1e2', display: 'block', marginBottom: '4px' }}>
                  Controller Operation Mode
                </label>
                <select
                  id="operation-mode"
                  value={operationMode}
                  onChange={e => setOperationMode(e.target.value as OperationMode)}
                  style={{ maxWidth: '320px' }}
                >
                  <option value="AUTO">AUTO (Automatic Heat/Cool Switching)</option>
                  <option value="HEAT">HEAT Only</option>
                  <option value="COOL">COOL Only</option>
                  <option value="FAN">FAN Only (Ventilation)</option>
                </select>
                <p className="hint" style={{ marginTop: '4px' }}>
                  Dictates the HVAC cycle state register written to the GB-50 EEPROM during occupied blocks.
                </p>
              </div>

              <div>
                <label htmlFor="wall-lockout" style={{ fontSize: '12px', color: '#c8d1e2', display: 'block', marginBottom: '4px' }}>
                  Wall Remote Controller Adjustments
                </label>
                <select
                  id="wall-lockout"
                  value={thermostatAllowed ? 'PERMIT' : 'PROHIBIT'}
                  onChange={e => setThermostatAllowed(e.target.value === 'PERMIT')}
                  style={{ maxWidth: '320px' }}
                >
                  <option value="PERMIT">PERMIT Local Adjustments (±2°F occupant override)</option>
                  <option value="PROHIBIT">PROHIBIT Local Adjustments (Lock wall keypad)</option>
                </select>
                <p className="hint" style={{ marginTop: '4px' }}>
                  Controls GB-50 remote controller interlock bits to prevent unauthorized setpoint tampering.
                </p>
              </div>

              {selectedGroupIds.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', color: '#8aa0c6', marginBottom: '6px' }}>
                    Mapped Controller Hardware Zones ({selectedGroupIds.length}):
                  </div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#9db8ff',
                    background: '#060a13',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #162033'
                  }}>
                    {selectedGroupIds.map(gid => {
                      const g = groups.find(grp => grp.group_id === gid);
                      return (
                        <span key={gid} style={{ background: '#131e33', padding: '2px 8px', borderRadius: '4px' }}>
                          Z{gid}: {g?.name || `Zone ${gid}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>

        {/* Sticky Summary Card */}
        <aside className="summary-card">
          <div className="eyebrow">Schedule summary</div>
          <h2>{name || 'Untitled Schedule'}</h2>
          <ul>
            <li>
              <small>Spaces</small>
              <strong id="summary-spaces">{spaceSummary}</strong>
            </li>
            <li>
              <small>Repeats</small>
              <strong>{daysSummary}</strong>
            </li>
            <li>
              <small>Occupied</small>
              <strong>{startsInput}–{endsInput}{durationText ? ` (${durationText})` : ''}</strong>
            </li>
            <li>
              <small>Comfort</small>
              <strong>{temperatureVal}°{tempUnit} · Auto</strong>
            </li>
          </ul>

          {validationError && (
            <div className="warning" style={{ margin: '10px 0', padding: '10px 12px', fontSize: '12px', color: '#fa7185', background: '#3b171d', borderColor: '#772533' }}>
              {validationError}
            </div>
          )}

          <button type="button" className="primary" onClick={handleProceedClick}>
            Review schedule →
          </button>
        </aside>
      </div>

      {/* Discard / Save Guard Modal */}
      {showDiscardGuard && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(5,9,24,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="form-card" style={{ maxWidth: '440px', width: '100%', background: '#111a2e', border: '1px solid #3b4e77' }}>
            <div className="section-title">
              <span className="num">!</span>
              <div>
                <h3>Save your changes?</h3>
                <p className="subtle">You have uncommitted edits. Save as draft before leaving?</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="button" className="primary" style={{ flex: 1 }} onClick={handleSaveAndClose}>
                Save as draft
              </button>
              <button type="button" className="secondary" onClick={onCancel}>
                Discard
              </button>
              <button type="button" className="quiet" onClick={() => setShowDiscardGuard(false)}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
