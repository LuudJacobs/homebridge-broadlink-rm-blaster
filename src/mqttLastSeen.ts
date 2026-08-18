export type LastSeenFormat = 'iso8601' | 'iso8601local' | 'epoch' | 'disabled';

export const DEFAULT_LAST_SEEN_FORMAT: LastSeenFormat = 'iso8601';

// Every MQTT publish (sensor readings and accessory state) can carry a
// last_seen field, same idea as zigbee2mqtt. `now` is a parameter rather
// than read internally so this stays pure and testable.
export function formatLastSeen(format: LastSeenFormat, now: Date): string | number | undefined {
  switch (format) {
    case 'iso8601':
      return now.toISOString();
    case 'iso8601local':
      return toLocalIso8601(now);
    case 'epoch':
      return now.getTime();
    case 'disabled':
      return undefined;
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

// Date's own toISOString() is always UTC - this builds the same shape using
// the local wall-clock time plus that same local offset.
function toLocalIso8601(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
}
