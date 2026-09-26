import React, { useMemo } from 'react';
import { ScheduleEventInput, OperationMode } from '../types';
import { formatTime12 } from '../utils/scheduleHelpers';

export interface TimelineSpan {
  startMin: number;
  endMin: number;
  startStr: string;
  endStr: string;
  drive: 'ON' | 'OFF';
  mode?: OperationMode;
  tempF?: number;
  tempC?: number;
  fanSpeed?: string;
  airDirection?: string;
  eventIndex?: number;
}

interface ScheduleTimelineBarProps {
  events: ScheduleEventInput[];
  tempUnit?: 'F' | 'C';
  className?: string;
  onSelectEvent?: (index: number) => void;
  height?: string;
  showTicks?: boolean;
}

export const ScheduleTimelineBar: React.FC<ScheduleTimelineBarProps> = ({
  events,
  tempUnit = 'F',
  className = '',
  onSelectEvent,
  height = 'h-11',
  showTicks = true,
}) => {
  const spans: TimelineSpan[] = useMemo(() => {
    if (!events || events.length === 0) {
      return [{
        startMin: 0,
        endMin: 1440,
        startStr: '12:00 AM',
        endStr: '12:00 AM',
        drive: 'OFF',
      }];
    }

    const sorted = [...events].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    const result: TimelineSpan[] = [];

    // Check if first event starts after 00:00
    const firstMin = sorted[0].hour * 60 + sorted[0].minute;
    if (firstMin > 0) {
      result.push({
        startMin: 0,
        endMin: firstMin,
        startStr: '12:00 AM',
        endStr: formatTime12(`${String(sorted[0].hour).padStart(2, '0')}:${String(sorted[0].minute).padStart(2, '0')}`),
        drive: 'OFF',
      });
    }

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const startMin = ev.hour * 60 + ev.minute;
      const nextMin = (i < sorted.length - 1) ? (sorted[i + 1].hour * 60 + sorted[i + 1].minute) : 1440;

      const time24Start = `${String(ev.hour).padStart(2, '0')}:${String(ev.minute).padStart(2, '0')}`;
      const startStr = formatTime12(time24Start);
      const endStr = (i < sorted.length - 1)
        ? formatTime12(`${String(sorted[i + 1].hour).padStart(2, '0')}:${String(sorted[i + 1].minute).padStart(2, '0')}`)
        : '12:00 AM';

      const isOff = ev.drive === 'OFF';
      const resolvedTempF = ev.set_temp_f ?? (ev.set_temp_c ? Math.round((ev.set_temp_c * 9 / 5) + 32) : 70);
      const resolvedTempC = ev.set_temp_c ?? (ev.set_temp_f ? Math.round(((ev.set_temp_f - 32) * 5 / 9) * 2) / 2 : 21);

      result.push({
        startMin,
        endMin: nextMin,
        startStr,
        endStr,
        drive: isOff ? 'OFF' : 'ON',
        mode: ev.mode as OperationMode,
        tempF: resolvedTempF,
        tempC: resolvedTempC,
        fanSpeed: ev.fan_speed,
        airDirection: ev.air_direction,
        eventIndex: i,
      });
    }

    return result;
  }, [events]);

  return (
    <div className={`w-full space-y-1.5 ${className}`}>
      {/* 24-Hour Track Container */}
      <div className={`relative ${height} bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex shadow-inner`}>
        {spans.map((span, idx) => {
          const widthPercent = ((span.endMin - span.startMin) / 1440) * 100;
          const isOn = span.drive === 'ON';
          const isClickable = span.eventIndex !== undefined && !!onSelectEvent;

          return (
            <div
              key={idx}
              style={{ width: `${widthPercent}%` }}
              onClick={() => {
                if (isClickable && span.eventIndex !== undefined) {
                  onSelectEvent(span.eventIndex);
                }
              }}
              className={`h-full flex flex-col items-center justify-center text-center px-1 transition-all border-r border-slate-800/80 overflow-hidden select-none ${
                isOn
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-emerald-500/40 text-emerald-300 font-semibold hover:from-emerald-500/30 hover:to-teal-500/30'
                  : 'bg-slate-950/90 text-slate-500 font-mono hover:bg-slate-900/50'
              } ${isClickable ? 'cursor-pointer' : ''}`}
              title={`${span.startStr} - ${span.endStr}: ${span.drive}${
                isOn ? ` (${tempUnit === 'F' ? `${span.tempF}°F` : `${span.tempC}°C`} · ${span.mode || 'AUTO'})` : ''
              }`}
            >
              {widthPercent >= 8 && (
                <span className="text-[11px] leading-tight truncate w-full">
                  {isOn ? (
                    <span>
                      {span.startStr} <span className="font-bold text-emerald-200">ON</span> {tempUnit === 'F' ? `${span.tempF}°` : `${span.tempC}°`}
                    </span>
                  ) : (
                    widthPercent >= 14 ? `${span.startStr} OFF` : 'OFF'
                  )}
                </span>
              )}
              {isOn && widthPercent >= 16 && (
                <span className="text-[9px] font-mono text-emerald-400/80 uppercase tracking-wider truncate">
                  {span.mode || 'AUTO'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Time Markers */}
      {showTicks && (
        <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1 select-none">
          <span>12 AM</span>
          <span>3 AM</span>
          <span>6 AM</span>
          <span>9 AM</span>
          <span>12 PM</span>
          <span>3 PM</span>
          <span>6 PM</span>
          <span>9 PM</span>
          <span>12 AM</span>
        </div>
      )}
    </div>
  );
};
