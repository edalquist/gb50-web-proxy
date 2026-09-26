import React from 'react';
import { formatTime12 } from '../utils/scheduleHelpers';

interface MiniTimelineBarProps {
  occupiedStart: string;
  occupiedEnd: string;
  temperatureF?: number;
  tempUnit?: 'F' | 'C';
  mode?: string;
  className?: string;
  showTicks?: boolean;
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 480; // default 8:00 AM
  const cleaned = timeStr.trim().toUpperCase();
  const isPM = cleaned.includes('PM');
  const isAM = cleaned.includes('AM');
  const numPart = cleaned.replace(/[^\d:]/g, '');
  const [hStr, mStr] = numPart.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return Math.min(1440, Math.max(0, h * 60 + m));
}

export const MiniTimelineBar: React.FC<MiniTimelineBarProps> = ({
  occupiedStart,
  occupiedEnd,
  temperatureF = 70,
  tempUnit = 'F',
  mode = 'Auto',
  className = '',
  showTicks = true,
}) => {
  const startMin = timeToMinutes(occupiedStart);
  let endMin = timeToMinutes(occupiedEnd);

  // If end is before or equal to start, ensure at least a 30m display block
  if (endMin <= startMin) {
    endMin = Math.min(1440, startMin + 60);
  }

  const leftPercent = Math.max(0, Math.min(100, (startMin / 1440) * 100));
  const widthPercent = Math.max(3, Math.min(100 - leftPercent, ((endMin - startMin) / 1440) * 100));

  const start12 = formatTime12(occupiedStart);
  const end12 = formatTime12(occupiedEnd);
  const tempVal = tempUnit === 'C' ? Math.round(((temperatureF - 32) * 5) / 9) : Math.round(temperatureF);

  const durationMinutes = endMin - startMin;
  const durationHours = (durationMinutes / 60).toFixed(1).replace('.0', '');

  return (
    <div className={`mini-timeline-container ${className}`} style={{ width: '100%' }}>
      {/* Visual Timeline Track */}
      <div
        className="timeline-track-bar"
        style={{
          position: 'relative',
          height: '24px',
          background: '#0a101f',
          borderRadius: '7px',
          overflow: 'hidden',
          border: '1px solid #1c273e',
        }}
      >
        {/* Tick grid lines at 6h intervals */}
        <div style={{ position: 'absolute', left: '25%', top: 0, bottom: 0, width: '1px', background: '#1c273e' }} />
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#24324f' }} />
        <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: '1px', background: '#1c273e' }} />

        {/* Occupied Conditioned Span */}
        <div
          className="timeline-span-occupied"
          style={{
            position: 'absolute',
            left: `${leftPercent}%`,
            width: `${widthPercent}%`,
            top: 0,
            bottom: 0,
            background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
            border: '1px solid #34d399',
            borderRadius: '5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 0 10px rgba(16, 185, 129, 0.35)',
            zIndex: 2,
          }}
          title={`${start12} – ${end12} (${durationHours} hrs) at ${tempVal}°${tempUnit} ${mode}`}
        >
          {widthPercent > 18 && (
            <span>
              {start12} – {end12} · {tempVal}°{tempUnit}
            </span>
          )}
        </div>
      </div>

      {/* Axis Ticks & Time Labels */}
      {showTicks && (
        <div
          className="timeline-ticks-row"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: '#64748b',
            marginTop: '3px',
            fontFamily: 'monospace',
            padding: '0 2px',
          }}
        >
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>12 AM</span>
        </div>
      )}
    </div>
  );
};
