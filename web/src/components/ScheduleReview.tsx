import React, { useState, useMemo } from 'react';
import { GroupStatus, SeasonConfig, ScheduleProgram, PublishResult, PublishProgress } from '../types';
import { 
  compactSpaceSummary, 
  formatDaysSummary, 
  formatTime12, 
  calculateNextOccurrence,
  getRoomDisplayName,
  detectScheduleConflicts,
  groupSpacesByArea
} from '../utils/scheduleHelpers';
import { MiniTimelineBar } from './MiniTimelineBar';

interface ScheduleReviewProps {
  scheduleData: any;
  groups: GroupStatus[];
  seasons: SeasonConfig[];
  programs?: ScheduleProgram[];
  tempUnit: 'F' | 'C';
  showFacilitiesDetail?: boolean;
  onPublish: (onProgress?: (progress: PublishProgress) => void) => Promise<PublishResult | null>;
  onBackToEdit: () => void;
  onSaveDraft: () => Promise<void>;
  onDone: () => void;
}

export const ScheduleReview: React.FC<ScheduleReviewProps> = ({
  scheduleData,
  groups,
  seasons,
  programs = [],
  tempUnit,
  showFacilitiesDetail = false,
  onPublish,
  onBackToEdit,
  onSaveDraft,
  onDone,
}) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublishedSuccess, setIsPublishedSuccess] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  const roomIds: number[] = scheduleData.room_ids && scheduleData.room_ids.length > 0 ? scheduleData.room_ids : [1, 2];
  const days: number[] = scheduleData.days || [7];
  const start12 = formatTime12(scheduleData.occupied_start || '07:30');
  const end12 = formatTime12(scheduleData.occupied_end || '13:00');
  const daysSummary = formatDaysSummary(days).replace('Every ', '');

  const tempVal = tempUnit === 'C'
    ? Math.round(((scheduleData.temperature_f || 70) - 32) * 5 / 9)
    : (scheduleData.temperature_f || 70);
  const modeVal = scheduleData.mode || 'AUTO';

  const durationText = useMemo(() => {
    const s24 = scheduleData.occupied_start || '07:30';
    const e24 = scheduleData.occupied_end || '13:00';
    const [sH, sM] = s24.split(':').map(Number);
    const [eH, eM] = e24.split(':').map(Number);
    const diff = (eH * 60 + eM) - (sH * 60 + sM);
    if (diff <= 0) return null;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m` : ''}`.trim();
  }, [scheduleData.occupied_start, scheduleData.occupied_end]);

  const weeklyHours = useMemo(() => {
    const s24 = scheduleData.occupied_start || '07:30';
    const e24 = scheduleData.occupied_end || '13:00';
    const [sH, sM] = s24.split(':').map(Number);
    const [eH, eM] = e24.split(':').map(Number);
    const diffMin = (eH * 60 + eM) - (sH * 60 + sM);
    if (diffMin <= 0) return null;
    const totalWeeklyMin = diffMin * days.length;
    const hours = (totalWeeklyMin / 60).toFixed(1).replace('.0', '');
    return `${hours} hrs/wk`;
  }, [scheduleData.occupied_start, scheduleData.occupied_end, days]);

  const spaceSummary = useMemo(() => {
    return compactSpaceSummary(roomIds, groups);
  }, [roomIds, groups]);

  const nextOcc = useMemo(() => {
    return calculateNextOccurrence(days, scheduleData.occupied_start || '07:30');
  }, [days, scheduleData.occupied_start]);

  const conflicts = useMemo(() => {
    return detectScheduleConflicts(
      scheduleData.id,
      roomIds,
      days,
      scheduleData.occupied_start || '07:30',
      scheduleData.occupied_end || '13:00',
      programs,
      groups,
      scheduleData.name
    );
  }, [scheduleData, roomIds, days, programs, groups]);

  const seasonName = useMemo(() => {
    if (scheduleData.season_id) {
      const s = seasons.find(sec => sec.season_id === scheduleData.season_id);
      if (s) return `${s.name} (${s.start_month}/${s.start_day}–${s.end_month}/${s.end_day})`;
    }
    if (scheduleData.start_date && scheduleData.end_date) {
      return `${scheduleData.start_date} through ${scheduleData.end_date}`;
    }
    return 'Year-round (Jan 1 through Dec 31)';
  }, [scheduleData, seasons]);

  const groupMap = useMemo(() => new Map(groups.map(g => [g.group_id, g])), [groups]);

  const selectedSpacesByArea = useMemo(() => {
    const selectedGroups = groups.filter(g => roomIds.includes(g.group_id));
    return groupSpacesByArea(selectedGroups);
  }, [groups, roomIds]);

  const hasLossnayUnits = useMemo(() => {
    return groups.some(g => roomIds.includes(g.group_id) && (g.model === 'LC' || (g.name && g.name.toLowerCase().includes('lossnay'))));
  }, [groups, roomIds]);

  const handlePublishClick = async () => {
    setIsPublishing(true);
    setPublishError(null);
    setProgress({
      schedule_id: scheduleData.id || 0,
      schedule_name: scheduleData.name || 'Schedule',
      current: 0,
      total: roomIds.length,
      percent: 0,
      status: 'flashing',
      successful_count: 0,
      failed_count: 0,
      room_statuses: Object.fromEntries(roomIds.map(id => [id, 'queued'])),
    });

    try {
      const result = await onPublish((p) => {
        setProgress(p);
      });
      setPublishResult(result);
      if (result && !result.success) {
        setPublishError(`Controller reported error writing to ${result.failed_spaces} of ${result.total_spaces} spaces.`);
      } else {
        setIsPublishedSuccess(true);
      }
    } catch (err: any) {
      setPublishError(err.message || 'Failed to communicate with controller hardware.');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <section id="review" className="screen active">
      <div className="review">
        <div className="page-head">
          <div>
            <div className="eyebrow">Final check</div>
            <h1>Review before publishing</h1>
            <p className="subtle">Nothing changes in the building until you publish to the GB-50 controller.</p>
          </div>
        </div>

        <div className="review-box">
          <div className="eyebrow">{scheduleData.name || 'New Schedule'}</div>
          <p className="sentence">
            Every <em>{daysSummary}</em>, from <em>{seasonName}</em>, maintain{' '}
            <em>{tempVal}°{tempUnit} ({modeVal})</em> in <em id="review-spaces">{spaceSummary}</em> between{' '}
            <em>{start12} and {end12}</em>.
          </p>

          {/* Embedded Universal 24-Hour Cycle Footprint */}
          <div style={{
            margin: '18px 0',
            background: '#0a101e',
            padding: '14px 16px',
            borderRadius: '10px',
            border: '1px solid #1f2d47'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8aa0c6', fontWeight: 600 }}>
                24-Hour Cycle Footprint (Occupied vs Standby)
              </span>
              <span style={{ fontSize: '11px', color: '#49d6a2', fontWeight: 600 }}>
                {durationText ? `${durationText} occupied · ${weeklyHours || ''}` : 'Daily Cycle'}
              </span>
            </div>
            <MiniTimelineBar
              occupiedStart={scheduleData.occupied_start || '07:30'}
              occupiedEnd={scheduleData.occupied_end || '13:00'}
              temperatureF={scheduleData.temperature_f || 70}
              tempUnit={tempUnit}
              mode={modeVal}
            />
          </div>

          {/* Key Schedule Checks Grid (8 Detailed Cards) */}
          <div className="check-grid">
            <div className="check">
              <small>First scheduled start</small>
              <strong>{nextOcc.fullDateText || nextOcc.text}</strong>
            </div>
            <div className="check">
              <small>Occupied hours &amp; runtime</small>
              <strong>{start12} – {end12} {durationText ? `(~${durationText}/day)` : ''}</strong>
            </div>
            <div className="check">
              <small>Weekly total runtime</small>
              <strong>{weeklyHours || 'N/A'} ({days.length} {days.length === 1 ? 'day' : 'days'}/wk)</strong>
            </div>
            <div className="check">
              <small>Target comfort &amp; mode</small>
              <strong>{tempVal}°{tempUnit} · {modeVal} (Auto Heat/Cool)</strong>
            </div>
            <div className="check">
              <small>Active season window</small>
              <strong>{seasonName}</strong>
            </div>
            <div className="check">
              <small>Spaces affected</small>
              <strong id="review-count">{roomIds.length} {roomIds.length === 1 ? 'space' : 'spaces'} ({selectedSpacesByArea.length} {selectedSpacesByArea.length === 1 ? 'area' : 'areas'})</strong>
            </div>
            <div className="check">
              <small>Wall keypad adjustments</small>
              <strong>{scheduleData.thermostat_adjustments_allowed !== false ? 'Permitted (±2°F local adjust)' : 'Prohibited (Wall keypad locked)'}</strong>
            </div>
            <div className="check">
              <small>After occupied hours</small>
              <strong>HVAC switches to Standby / Setback at {end12}</strong>
            </div>
          </div>

          {/* Assigned Spaces Breakdown (Grouped by Floor / Area) */}
          <div style={{
            background: '#090f1d',
            border: '1px solid #1c2a44',
            borderRadius: '10px',
            padding: '16px',
            marginTop: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '13px', color: '#eef3ff' }}>
                Assigned Spaces ({roomIds.length} {roomIds.length === 1 ? 'space' : 'spaces'})
              </strong>
              <span style={{ fontSize: '11px', color: '#7e93b8' }}>
                Structured by facility area &amp; equipment type
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {selectedSpacesByArea.map(area => (
                <div key={area.name} style={{ background: '#0e172a', borderRadius: '8px', padding: '10px 12px', border: '1px solid #1a2740' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#9db8ff' }}>
                      {area.name}
                    </span>
                    <span style={{ fontSize: '11px', color: '#6882a9' }}>
                      {area.groups.length} {area.groups.length === 1 ? 'space' : 'spaces'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {area.groups.map(g => (
                      <span
                        key={g.group_id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#15223c',
                          color: '#dbe5ff',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          border: '1px solid #23375e'
                        }}
                      >
                        <span>{getRoomDisplayName(g)}</span>
                        {showFacilitiesDetail && (
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#7ba4ff' }}>
                            [Z{g.group_id}]
                          </span>
                        )}
                        {g.model === 'LC' && (
                          <span style={{ fontSize: '10px', background: '#1c3830', color: '#49d6a2', padding: '1px 5px', borderRadius: '4px' }}>
                            HRU
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {hasLossnayUnits && (
              <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#49d6a2' }}>
                <span>✓</span>
                <span>Fresh-air ventilation systems (Lossnay HRUs) are interlocked to cycle automatically with these spaces.</span>
              </div>
            )}
          </div>

          {/* Compiled Controller Timer Routines (GB-50 Hardware Execution Plan) */}
          <details className="system-details" style={{
            background: '#090f1d',
            border: '1px solid #1c2a44',
            borderRadius: '10px',
            padding: '14px 16px',
            marginTop: '16px'
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
                <span>Compiled Controller Timer Events &amp; EEPROM Profile</span>
              </span>
              <span style={{ fontSize: '11px', color: '#6882a9' }}>View GB-50 Register Sequence</span>
            </summary>

            <div style={{ marginTop: '14px', borderTop: '1px solid #1a2740', paddingTop: '14px' }}>
              <p style={{ fontSize: '12px', color: '#9ca9c3', marginBottom: '12px' }}>
                Publishing compiles this schedule into paired timer events stored directly in Mitsubishi GB-50 controller EEPROM:
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                {/* Event 1: Occupied Start */}
                <div style={{ background: '#0e172a', padding: '12px', borderRadius: '8px', border: '1px solid #1b2e4b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#49d6a2', letterSpacing: '0.4px' }}>
                      Event 1 · Occupied Start
                    </span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: '#fff', background: '#173628', padding: '2px 6px', borderRadius: '4px' }}>
                      {start12}
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#c8d4ee', lineHeight: 1.6 }}>
                    <li><strong>Drive:</strong> ON (Conditioning Active)</li>
                    <li><strong>Mode:</strong> {modeVal}</li>
                    <li><strong>Setpoint:</strong> {tempVal}°{tempUnit}</li>
                    <li><strong>Wall Keypad:</strong> {scheduleData.thermostat_adjustments_allowed !== false ? 'Permit Local Adjustment (±2°F)' : 'Prohibit (Keypad Locked)'}</li>
                    <li><strong>Ventilation:</strong> Fresh Air Interlock Enabled</li>
                  </ul>
                </div>

                {/* Event 2: Occupied End / Standby */}
                <div style={{ background: '#0e172a', padding: '12px', borderRadius: '8px', border: '1px solid #1b2e4b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#fa7185', letterSpacing: '0.4px' }}>
                      Event 2 · Standby / Off
                    </span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: '#fff', background: '#3b171e', padding: '2px 6px', borderRadius: '4px' }}>
                      {end12}
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#c8d4ee', lineHeight: 1.6 }}>
                    <li><strong>Drive:</strong> OFF (Standby / Night Setback)</li>
                    <li><strong>Mode:</strong> Retain previous state register</li>
                    <li><strong>Wall Keypad:</strong> Prohibit (Prevent unauthorized after-hours override)</li>
                    <li><strong>Ventilation:</strong> Fresh Air Standby</li>
                  </ul>
                </div>
              </div>

              <div style={{ background: '#060a14', padding: '10px 12px', borderRadius: '6px', border: '1px solid #152238', fontSize: '11px', color: '#8297ba', fontFamily: 'monospace' }}>
                Target Controller: Mitsubishi GB-50 · Registers: Weekly Pattern EEPROM ({days.length} active {days.length === 1 ? 'day' : 'days'}) · Zones: {roomIds.map(id => `Z${id}`).join(', ')}
              </div>
            </div>
          </details>

          {conflicts.length > 0 ? (
            <div className="warning" style={{ background: '#3b2512', borderColor: '#b87720', color: '#ffd580', marginTop: '16px' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Potential Scheduling Conflict Detected:</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {conflicts.slice(0, 3).map((c, i) => (
                  <li key={i}>{c.conflictingProgramName} also schedules {c.roomName} on {c.dayName} ({c.timeRange}).</li>
                ))}
              </ul>
              <small style={{ display: 'block', marginTop: 6, color: '#e0b560' }}>
                Publishing will update controller timer events for conflicting periods.
              </small>
            </div>
          ) : (
            <div className="warning" style={{ background: '#102523', borderColor: '#315f59', color: '#64e3b4', marginTop: '16px' }}>
              ✓ No conflicts found. These rooms have no overlapping events scheduled for the selected days.
            </div>
          )}

          {/* Real-time Flashing Progress Display */}
          {progress && (
            <div className="flashing-progress-card" style={{ marginTop: '16px' }}>
              <div className="flashing-header">
                <div className="flashing-title">
                  <span className={`flashing-badge ${progress.status}`}>
                    {isPublishing
                      ? '⚡ Flashing Controller EEPROM'
                      : progress.status === 'completed' && (!publishResult || publishResult.success)
                      ? '✓ Flashing Complete'
                      : '⚠ Flashing Completed with Errors'}
                  </span>
                  <span className="flashing-count">
                    {progress.current} of {progress.total} spaces ({progress.percent}%)
                  </span>
                </div>
                <p className="flashing-subtitle">
                  {isPublishing
                    ? `Writing weekly schedule routines to Mitsubishi GB-50 memory for ${scheduleData.name || 'schedule'}...`
                    : progress.status === 'completed' && (!publishResult || publishResult.success)
                    ? `All ${progress.total} spaces successfully flashed to controller EEPROM and verified.`
                    : `Flashing completed with errors on ${progress.failed_count} space(s).`}
                </p>
              </div>

              {/* Animated Progress Bar */}
              <div className="progress-bar-track">
                <div
                  className={`progress-bar-fill ${progress.status}`}
                  style={{ width: `${Math.max(4, progress.percent)}%` }}
                />
              </div>

              {/* Current flashing room callout */}
              {isPublishing && progress.room_name && (
                <div className="flashing-current-callout">
                  <span className="pulse-dot" />
                  <span>
                    Currently writing: <strong>{progress.room_name}</strong> (Zone {progress.group_id}) &rarr; compiling and verifying EEPROM...
                  </span>
                </div>
              )}

              {/* Per-Room Status Grid */}
              <div className="flashing-room-grid">
                {roomIds.map(id => {
                  const g = groupMap.get(id);
                  const name = g ? getRoomDisplayName(g) : `Zone ${id}`;
                  const roomStatus = progress.room_statuses?.[id] || (progress.status === 'completed' ? 'success' : 'queued');
                  const isCurrentFlashing = isPublishing && progress.group_id === id;

                  return (
                    <div
                      key={id}
                      className={`flashing-room-pill ${roomStatus} ${isCurrentFlashing ? 'active-flashing' : ''}`}
                    >
                      <span className="room-icon">
                        {roomStatus === 'success' ? '✓' : roomStatus === 'failed' ? '✕' : isCurrentFlashing ? '⚡' : '⏳'}
                      </span>
                      <span className="room-name">{name}</span>
                      <span className="room-status-label">
                        {roomStatus === 'success' ? 'Flashed' : roomStatus === 'failed' ? 'Failed' : isCurrentFlashing ? 'Writing...' : 'Queued'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Failed rooms error details */}
              {publishResult && publishResult.failed_rooms && publishResult.failed_rooms.length > 0 && (
                <div className="flashing-error-details">
                  <strong>Errors reported by controller:</strong>
                  <ul>
                    {publishResult.failed_rooms.map(fr => {
                      const g = groupMap.get(fr.group_id);
                      const rName = g ? getRoomDisplayName(g) : `Zone ${fr.group_id}`;
                      return (
                        <li key={fr.group_id}>
                          <strong>{rName}:</strong> {fr.error}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {publishError && !progress && (
            <div className="warning" style={{ background: '#44181f', borderColor: '#fa7185', color: '#ffadb9', marginTop: '16px' }}>
              <strong>Publish failed:</strong> {publishError}
            </div>
          )}

          <div className="actions" style={{ marginTop: '20px' }}>
            <p className="publish-note">
              {isPublishing
                ? 'Writing directly to GB-50 controller memory. Please keep this browser window open.'
                : 'If publishing fails, this schedule remains a draft and no partial success will be hidden.'}
            </p>
            <div>
              <button type="button" className="secondary" onClick={onBackToEdit} disabled={isPublishing}>
                Back to edit
              </button>
              {!isPublishedSuccess && !isPublishing && (
                <button type="button" className="quiet" onClick={onSaveDraft}>
                  Save draft
                </button>
              )}
              {isPublishedSuccess ? (
                <button type="button" className="primary" style={{ background: '#16825f' }} onClick={onDone}>
                  ✓ Published — Back to schedules
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  id="publish"
                  onClick={handlePublishClick}
                  disabled={isPublishing}
                >
                  {isPublishing
                    ? `Flashing EEPROM (${progress?.percent || 0}%)...`
                    : 'Publish schedule'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
