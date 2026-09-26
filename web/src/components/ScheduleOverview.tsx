import React, { useState, useMemo } from 'react';
import { GroupStatus, ScheduleProgram, SeasonConfig, SeasonReconcileStatus } from '../types';
import { 
  compactSpaceSummary, 
  formatDaysSummary, 
  formatTime12, 
  calculateNextOccurrence 
} from '../utils/scheduleHelpers';
import { MiniTimelineBar } from './MiniTimelineBar';

interface ScheduleOverviewProps {
  programs: ScheduleProgram[];
  groups: GroupStatus[];
  seasons: SeasonConfig[];
  tempUnit: 'F' | 'C';
  seasonReconciliation?: SeasonReconcileStatus | null;
  showFacilitiesDetail?: boolean;
  hideHeader?: boolean;
  onNewSchedule: () => void;
  onEditSchedule: (program: ScheduleProgram) => void;
  onReviewSchedule: (program: ScheduleProgram) => void;
  onDuplicateSchedule?: (program: ScheduleProgram) => void;
  onDeleteSchedule?: (program: ScheduleProgram) => void;
  onOpenAdvanced: () => void;
  onReconcileSeasons: () => void;
}

type FilterType = 'upcoming' | 'repeating' | 'onetime' | 'drafts';

export const ScheduleOverview: React.FC<ScheduleOverviewProps> = ({
  programs,
  groups,
  seasons,
  tempUnit,
  seasonReconciliation,
  showFacilitiesDetail = false,
  hideHeader = false,
  onNewSchedule,
  onEditSchedule,
  onReviewSchedule,
  onDuplicateSchedule,
  onDeleteSchedule,
  onOpenAdvanced,
  onReconcileSeasons,
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterType>('upcoming');

  // Fallback demo schedules if DB is totally empty
  const displayPrograms = useMemo(() => {
    if (programs.length > 0) return programs;
    return [
      {
        id: 1,
        name: 'Sunday Worship',
        description: 'Occupied 7:30 AM - 1:00 PM at 70°F',
        color: 'blue',
        season_id: 1,
        season_scope: ['1'],
        weekly_pattern: { 7: [] },
        assigned_group_ids: [1, 2],
        sync_status: 'SYNCED' as const,
        weekly_hours: 5.5,
        metadata_json: {
          occupied_start: '07:30',
          occupied_end: '13:00',
          temperature_f: 70,
          mode: 'AUTO',
          thermostat_adjustments_allowed: true,
          recurrence_kind: 'weekly',
          days: [7],
          start_date: 'Apr 1',
          end_date: 'Sep 30',
          status: 'published',
        },
      },
      {
        id: 2,
        name: 'Weekday Office Hours',
        description: 'Occupied 8:00 AM - 5:00 PM at 72°F',
        color: 'emerald',
        season_id: 1,
        season_scope: ['1'],
        weekly_pattern: { 1: [], 2: [], 3: [], 4: [], 5: [] },
        assigned_group_ids: [5],
        sync_status: 'SYNCED' as const,
        weekly_hours: 45,
        metadata_json: {
          occupied_start: '08:00',
          occupied_end: '17:00',
          temperature_f: 72,
          mode: 'AUTO',
          thermostat_adjustments_allowed: true,
          recurrence_kind: 'weekly',
          days: [1, 2, 3, 4, 5],
          start_date: 'Jan 1',
          end_date: 'Dec 31',
          status: 'published',
        },
      },
      {
        id: 3,
        name: 'Choir Rehearsal',
        description: 'Occupied 6:00 PM - 9:00 PM at 70°F',
        color: 'amber',
        season_id: 1,
        season_scope: ['1'],
        weekly_pattern: { 4: [] },
        assigned_group_ids: [1, 22],
        sync_status: 'PENDING' as const,
        weekly_hours: 3,
        metadata_json: {
          occupied_start: '18:00',
          occupied_end: '21:00',
          temperature_f: 70,
          mode: 'AUTO',
          thermostat_adjustments_allowed: true,
          recurrence_kind: 'weekly',
          days: [4],
          start_date: 'Sep 15',
          end_date: 'Dec 20',
          status: 'draft',
        },
      },
    ];
  }, [programs]);

  const draftCount = useMemo(() => {
    return displayPrograms.filter(p => {
      const meta = p.metadata_json;
      return meta?.status === 'draft' || p.sync_status === 'PENDING' || p.sync_status === 'ERROR';
    }).length;
  }, [displayPrograms]);

  const filteredPrograms = useMemo(() => {
    return displayPrograms.filter(p => {
      const meta = p.metadata_json;
      const isDraft = meta?.status === 'draft' || p.sync_status === 'PENDING' || p.sync_status === 'ERROR';
      const isOneTime = meta?.recurrence_kind === 'once';

      if (activeFilter === 'drafts') return isDraft;
      if (activeFilter === 'onetime') return isOneTime;
      if (activeFilter === 'repeating') return !isOneTime && !isDraft;
      return true; // 'upcoming'
    });
  }, [displayPrograms, activeFilter]);

  // Compute "Next HVAC change" banner
  const nextChangeInfo = useMemo(() => {
    const published = displayPrograms.filter(p => p.sync_status === 'SYNCED' && p.metadata_json?.status !== 'draft');
    const target = published[0] || displayPrograms[0];
    if (!target) {
      return {
        text: 'Sunday at 7:30 AM · Sanctuary and Fellowship Hall turn on to 70°F',
        status: 'Published',
      };
    }
    const meta = target.metadata_json || {};
    const days = meta.days || (target.weekly_pattern ? Object.keys(target.weekly_pattern).map(Number) : [7]);
    const startTime24 = meta.occupied_start || '07:30';
    const occ = calculateNextOccurrence(days, startTime24);
    const spaceNames = compactSpaceSummary(target.assigned_group_ids || [], groups);
    const targetTemp = meta.temperature_f
      ? (tempUnit === 'C' ? `${Math.round((meta.temperature_f - 32) * 5 / 9)}°C` : `${meta.temperature_f}°F`)
      : (tempUnit === 'C' ? '21°C' : '70°F');

    return {
      text: `${occ.dayName} at ${occ.timeStr} · ${spaceNames} turn on to ${targetTemp}`,
      status: target.sync_status === 'SYNCED' ? 'Published' : 'Draft',
    };
  }, [displayPrograms, groups, tempUnit]);

  const seasonMap = useMemo(() => {
    const map = new Map<number, SeasonConfig>();
    seasons.forEach(s => map.set(s.season_id, s));
    return map;
  }, [seasons]);

  return (
    <section id="overview" className="screen active">
      {/* Page Head */}
      {!hideHeader && (
        <div className="page-head">
          <div>
            <div className="eyebrow">Schedules</div>
            <h1>Keep every space comfortable</h1>
            <p className="subtle">See what is happening next or plan HVAC around occupied hours and events.</p>
          </div>
          <button type="button" className="primary" onClick={onNewSchedule}>
            ＋ New schedule
          </button>
        </div>
      )}

      {/* Season Reconciliation Warning Banner (if detected) */}
      {seasonReconciliation && !seasonReconciliation.reconciled && (
        <div className="warning" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div>
            <strong style={{ color: '#ffd17e', display: 'block' }}>Schedule dates need attention</strong>
            <span style={{ fontSize: '12px' }}>Application season dates differ from controller hardware.</span>
          </div>
          <button type="button" className="quiet" onClick={onReconcileSeasons} style={{ fontSize: '12px', padding: '6px 10px' }}>
            Review &amp; Reconcile Seasons →
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="filters">
        <button
          type="button"
          className={activeFilter === 'upcoming' ? 'active' : ''}
          onClick={() => setActiveFilter('upcoming')}
        >
          Upcoming
        </button>
        <button
          type="button"
          className={activeFilter === 'repeating' ? 'active' : ''}
          onClick={() => setActiveFilter('repeating')}
        >
          Repeating
        </button>
        <button
          type="button"
          className={activeFilter === 'onetime' ? 'active' : ''}
          onClick={() => setActiveFilter('onetime')}
        >
          One-time
        </button>
        <button
          type="button"
          className={activeFilter === 'drafts' ? 'active' : ''}
          onClick={() => setActiveFilter('drafts')}
        >
          Drafts ({draftCount})
        </button>
      </div>

      {/* Next HVAC change banner */}
      <div className="next-change">
        <div className="next-icon">◷</div>
        <div>
          <small>Next HVAC change</small>
          <strong>{nextChangeInfo.text}</strong>
        </div>
        <span className="live">{nextChangeInfo.status}</span>
      </div>

      {/* Schedule list */}
      <div className="schedule-list">
        {filteredPrograms.map(prog => {
          const meta = prog.metadata_json || {};
          const isDraft = meta.status === 'draft' || prog.sync_status === 'PENDING';
          const isFailed = prog.sync_status === 'ERROR' || meta.status === 'failed';
          const isPublished = prog.sync_status === 'SYNCED' && !isDraft && !isFailed;

          const days = meta.days || (prog.weekly_pattern ? Object.keys(prog.weekly_pattern).map(Number) : [7]);
          const daysLabel = formatDaysSummary(days);

          let seasonLabel = 'Year-round';
          if (prog.season_id && seasonMap.has(prog.season_id)) {
            seasonLabel = seasonMap.get(prog.season_id)!.name;
          } else if (meta.start_date && meta.end_date) {
            seasonLabel = `${meta.start_date}–${meta.end_date}`;
          }

          const start12 = formatTime12(meta.occupied_start || '07:30');
          const end12 = formatTime12(meta.occupied_end || '13:00');
          const timeLabel = `${start12}–${end12}`;

          const spacesLabel = compactSpaceSummary(prog.assigned_group_ids || [], groups);
          const tempVal = tempUnit === 'C' ? Math.round(((meta.temperature_f || 70) - 32) * 5 / 9) : (meta.temperature_f || 70);
          const modeVal = meta.mode || 'Auto';

          return (
            <article className="schedule" key={prog.id}>
              <div>
                <div className="schedule-top">
                  <h3>{prog.name}</h3>
                  <span className={`status ${isPublished ? 'published' : isDraft ? 'draft' : 'failed'}`}>
                    {isPublished ? 'Published' : isDraft ? 'Draft' : 'Publish failed'}
                  </span>
                </div>
                <div className="details">
                  <span className="calendar">{daysLabel} · {seasonLabel}</span>
                  <span className="clock">{timeLabel}</span>
                  <span className="rooms">{spacesLabel}</span>
                  <span className="temp">{tempVal}°{tempUnit} · {modeVal}</span>
                </div>

                {/* Embedded 24-Hour Visual Mini-Timeline */}
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                    <span style={{ fontSize: '10px', color: '#8290aa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      24-Hour Day Footprint:
                    </span>
                    {showFacilitiesDetail && (
                      <span style={{ fontSize: '10px', fontFamily: 'monospace', color: prog.sync_status === 'SYNCED' ? '#49d6a2' : '#f0ba5a' }}>
                        EEPROM: {prog.sync_status || 'PENDING'}
                      </span>
                    )}
                  </div>
                  <MiniTimelineBar
                    occupiedStart={meta.occupied_start || '07:30'}
                    occupiedEnd={meta.occupied_end || '13:00'}
                    temperatureF={meta.temperature_f || 70}
                    tempUnit={tempUnit}
                    mode={modeVal}
                  />
                  {showFacilitiesDetail && prog.assigned_group_ids && prog.assigned_group_ids.length > 0 && (
                    <div style={{ marginTop: '5px', fontSize: '11px', color: '#7da2ff', fontFamily: 'monospace' }}>
                      Controller Zones: {prog.assigned_group_ids.map(id => {
                        const g = groups.find(grp => grp.group_id === id);
                        return `Z${id}${g?.name ? ` (${g.name})` : ''}`;
                      }).join(', ')}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className="more"
                  onClick={() => isDraft ? onReviewSchedule(prog) : onEditSchedule(prog)}
                >
                  {isDraft ? 'Finish draft' : isFailed ? 'Retry publish' : 'View or edit'}
                </button>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {onDuplicateSchedule && (
                    <button
                      type="button"
                      onClick={() => onDuplicateSchedule(prog)}
                      title="Duplicate schedule"
                      style={{ background: 'transparent', border: '1px solid #344361', color: '#9ca9c3', borderRadius: '7px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Copy
                    </button>
                  )}
                  {onDeleteSchedule && (
                    <button
                      type="button"
                      onClick={() => onDeleteSchedule(prog)}
                      title="Delete schedule"
                      style={{ background: 'transparent', border: '1px solid #5a2632', color: '#fa7185', borderRadius: '7px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {filteredPrograms.length === 0 && (
          <div className="form-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <h3>No schedules found</h3>
            <p className="subtle" style={{ marginTop: '6px', marginBottom: '18px' }}>
              {activeFilter === 'drafts' 
                ? 'There are no pending draft schedules.'
                : 'No schedules match the selected filter. Create a schedule to automate heating and cooling.'}
            </p>
            <button type="button" className="primary" onClick={onNewSchedule}>
              ＋ New schedule
            </button>
          </div>
        )}
      </div>

      {/* Advanced Footer */}
      <div className="advanced">
        <div>
          <strong>Facilities and controller tools</strong>
          <p className="subtle">Programs, seasons, zone matrix, and publishing diagnostics</p>
        </div>
        <button type="button" className="quiet" onClick={onOpenAdvanced}>
          Advanced scheduling →
        </button>
      </div>
    </section>
  );
};
