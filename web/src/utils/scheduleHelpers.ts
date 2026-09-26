import { GroupStatus } from '../types';

export function formatTime12(time24?: string): string {
  if (!time24) return '12:00 PM';
  const parts = time24.split(':');
  if (parts.length < 2) return time24;
  let hour = parseInt(parts[0], 10);
  const minute = parts[1].slice(0, 2);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute.padStart(2, '0')} ${ampm}`;
}

export function parseTime12(timeStr: string): string {
  if (!timeStr) return '08:00';
  const cleaned = timeStr.trim();
  // Check if already in 24h format HH:MM
  const match24 = cleaned.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (match24) {
    const h = match24[1].padStart(2, '0');
    return `${h}:${match24[2]}`;
  }

  // Match 12h format e.g. "7:30 AM" or "12:00pm" or "8 am"
  const match12 = cleaned.match(/^([0-9]{1,2})(?::([0-5][0-9]))?\s*(am|pm)?$/i);
  if (match12) {
    let hour = parseInt(match12[1], 10);
    const minute = match12[2] ? match12[2] : '00';
    const ampm = (match12[3] || 'AM').toUpperCase();

    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${minute}`;
  }

  return '08:00';
}

export function getRoomDisplayName(group: GroupStatus): string {
  if (group.name && group.name.trim().length > 0) {
    return group.name.trim();
  }
  if (group.room_name && group.room_name.trim().length > 0) {
    return group.room_name.trim();
  }
  return `Zone ${group.group_id}`;
}

export function getAreaDisplayName(group: GroupStatus): string {
  if (group.area_name && group.area_name.trim().length > 0) {
    return group.area_name.trim();
  }
  if (group.model === 'LC') {
    return 'Ventilation (Lossnay)';
  }
  if (group.floor) {
    return `Floor ${group.floor}`;
  }
  return `Zone ${group.group_id}`;
}

export function compactSpaceSummary(selectedIds: number[], groups: GroupStatus[]): string {
  if (!selectedIds.length) return 'No spaces selected';
  const groupMap = new Map(groups.map(g => [g.group_id, g]));
  const names = selectedIds
    .map(id => {
      const g = groupMap.get(id);
      return g ? getRoomDisplayName(g) : `Zone ${id}`;
    })
    .filter(Boolean);

  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, ${names[2]}`;

  return `${names.length} spaces`;
}

export function formatDaysSummary(days: number[]): string {
  if (!days || days.length === 0) return 'No days selected';
  const sorted = [...days].sort((a, b) => a - b);
  
  const dayLabels: Record<number, string> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
    7: 'Sun',
  };

  const fullDayLabels: Record<number, string> = {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  };

  if (sorted.length === 7) return 'Every day';
  if (sorted.length === 1) return `Every ${fullDayLabels[sorted[0]]}`;
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return 'Monday–Friday';
  if (sorted.length === 2 && sorted.includes(6) && sorted.includes(7)) return 'Weekends (Sat–Sun)';

  return sorted.map(d => dayLabels[d]).join(', ');
}

export function calculateNextOccurrence(days: number[], time24: string): { dayName: string; timeStr: string; text: string; fullDateText: string } {
  if (!days || days.length === 0) {
    const formatted = formatTime12(time24);
    return { dayName: 'Soon', timeStr: formatted, text: `At ${formatted}`, fullDateText: `Upcoming at ${formatted}` };
  }

  const now = new Date();
  const currentJsDay = now.getDay(); // 0=Sun, 1=Mon..6=Sat
  // Convert JS day (0=Sun..6=Sat) to GB-50 day (1=Mon..7=Sun)
  const currentGbDay = currentJsDay === 0 ? 7 : currentJsDay;

  const [targetH, targetM] = (time24 || '08:00').split(':').map(n => parseInt(n, 10));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = (targetH || 8) * 60 + (targetM || 0);

  let daysUntil = -1;
  let nextDayId = -1;

  for (let offset = 0; offset < 7; offset++) {
    const testDay = ((currentGbDay - 1 + offset) % 7) + 1;
    if (days.includes(testDay)) {
      if (offset === 0) {
        if (targetMinutes > currentMinutes) {
          daysUntil = 0;
          nextDayId = testDay;
          break;
        }
      } else {
        daysUntil = offset;
        nextDayId = testDay;
        break;
      }
    }
  }

  if (daysUntil === -1) {
    daysUntil = 7;
    nextDayId = days[0];
  }

  const gbDayNames: Record<number, string> = {
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
    7: 'Sunday',
  };

  const formattedTime = formatTime12(time24);
  const dayText = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : gbDayNames[nextDayId] || 'Upcoming';
  const occDate = new Date(now.getTime() + (daysUntil >= 0 ? daysUntil : 0) * 86400000);
  const fullDateText = `${gbDayNames[nextDayId]}, ${occDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${formattedTime}`;

  return {
    dayName: dayText,
    timeStr: formattedTime,
    text: `${dayText} at ${formattedTime}`,
    fullDateText,
  };
}

export interface ConflictDetail {
  conflictingProgramName: string;
  roomName: string;
  dayName: string;
  timeRange: string;
}

export function detectScheduleConflicts(
  currentProgramId: number | string | undefined,
  roomIds: number[],
  days: number[],
  start24: string,
  end24: string,
  programs: import('../types').ScheduleProgram[],
  groups: GroupStatus[],
  currentProgramName?: string
): ConflictDetail[] {
  const conflicts: ConflictDetail[] = [];
  const groupMap = new Map(groups.map(g => [g.group_id, g]));
  
  const [sH, sM] = (start24 || '08:00').split(':').map(Number);
  const [eH, eM] = (end24 || '17:00').split(':').map(Number);
  const startMin = (sH || 0) * 60 + (sM || 0);
  const endMin = (eH || 0) * 60 + (eM || 0);

  const dayNames: Record<number, string> = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday'
  };

  const normalizedCurrentName = (currentProgramName || '').trim().toLowerCase();

  programs.forEach(p => {
    // 1. Skip if it is the current program by ID
    if (currentProgramId && String(p.id) === String(currentProgramId)) return;

    // 2. Skip if it is the same program by Name
    if (normalizedCurrentName && p.name && p.name.trim().toLowerCase() === normalizedCurrentName) {
      return;
    }

    // 3. Skip placeholder / standby / unscheduled programs
    const pNameLower = (p.name || '').toLowerCase();
    if (pNameLower.includes('standby') || pNameLower.includes('unscheduled')) {
      return;
    }

    const meta = p.metadata_json || {};
    const pRooms = p.assigned_group_ids || [];
    const commonRooms = roomIds.filter(id => pRooms.includes(id));
    if (commonRooms.length === 0) return;

    // 4. Identify active days with real conditioning events
    let pDays: number[] = [];
    if (meta.days && Array.isArray(meta.days) && meta.days.length > 0) {
      pDays = meta.days;
    } else if (p.weekly_pattern) {
      pDays = Object.entries(p.weekly_pattern)
        .filter(([_, events]) => Array.isArray(events) && events.some((e: any) => e.drive !== 'OFF'))
        .map(([d, _]) => Number(d));
    }

    const commonDays = days.filter(d => pDays.includes(d));
    if (commonDays.length === 0) return;

    // 5. Check real time overlap on common days
    commonDays.forEach(dayId => {
      let pStartMin: number | null = null;
      let pEndMin: number | null = null;
      let pTimeRangeStr = '';

      if (meta.occupied_start && meta.occupied_end) {
        const [psH, psM] = meta.occupied_start.split(':').map(Number);
        const [peH, peM] = meta.occupied_end.split(':').map(Number);
        pStartMin = (psH || 0) * 60 + (psM || 0);
        pEndMin = (peH || 0) * 60 + (peM || 0);
        pTimeRangeStr = `${formatTime12(meta.occupied_start)}–${formatTime12(meta.occupied_end)}`;
      } else if (p.weekly_pattern && p.weekly_pattern[dayId]) {
        const dayEvs = p.weekly_pattern[dayId] || [];
        const onEv = dayEvs.find((e: any) => e.drive !== 'OFF');
        const offEv = dayEvs.find((e: any) => e.drive === 'OFF' && (onEv ? (e.hour * 60 + e.minute) > (onEv.hour * 60 + onEv.minute) : true));
        if (onEv) {
          pStartMin = onEv.hour * 60 + onEv.minute;
          pEndMin = offEv ? (offEv.hour * 60 + offEv.minute) : Math.min(1440, pStartMin + 480);
          pTimeRangeStr = `${formatTime12(`${onEv.hour}:${onEv.minute}`)}–${offEv ? formatTime12(`${offEv.hour}:${offEv.minute}`) : 'End of day'}`;
        }
      }

      if (pStartMin === null || pEndMin === null) return;

      // Check overlap
      if (startMin < pEndMin && endMin > pStartMin) {
        commonRooms.forEach(roomId => {
          const g = groupMap.get(roomId);
          const roomLabel = g ? getRoomDisplayName(g) : `Zone ${roomId}`;
          conflicts.push({
            conflictingProgramName: p.name,
            roomName: roomLabel,
            dayName: dayNames[dayId] || `Day ${dayId}`,
            timeRange: pTimeRangeStr,
          });
        });
      }
    });
  });

  return conflicts;
}

export interface AreaGroup {
  name: string;
  groups: GroupStatus[];
}

export function groupSpacesByArea(groups: GroupStatus[]): AreaGroup[] {
  const map = new Map<string, GroupStatus[]>();
  
  groups.forEach(g => {
    const area = getAreaDisplayName(g);
    if (!map.has(area)) {
      map.set(area, []);
    }
    map.get(area)!.push(g);
  });

  const result: AreaGroup[] = [];
  const order = ['Floor 1', 'Floor 2', 'Ventilation (Lossnay)'];
  
  order.forEach(areaName => {
    if (map.has(areaName)) {
      result.push({ name: areaName, groups: map.get(areaName)! });
      map.delete(areaName);
    }
  });

  map.forEach((gList, areaName) => {
    result.push({ name: areaName, groups: gList });
  });

  return result;
}
