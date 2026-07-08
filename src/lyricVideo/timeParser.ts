export interface TimeRange {
  startMs: number;
  endMs: number;
}

const TIME_PATTERN =
  /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/;

function parseSingleTime(timeStr: string): number {
  const trimmed = timeStr.trim();

  const match = trimmed.match(TIME_PATTERN);
  if (!match) {
    throw new Error(`Invalid time format: "${trimmed}"`);
  }

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  const millis = match[4] ? parseInt(match[4].padEnd(3, "0").slice(0, 3), 10) : 0;

  if (minutes > 59 || seconds > 59) {
    throw new Error(`Invalid time values: "${trimmed}"`);
  }

  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis;
}

export function parseTimeRange(input: string): TimeRange {
  const trimmed = input.trim();

  const dashIndex = trimmed.indexOf("-");
  if (dashIndex === -1) {
    throw new Error('Time range must use format "start-end" (e.g., "0:12-1:08")');
  }

  const startStr = trimmed.slice(0, dashIndex);
  const endStr = trimmed.slice(dashIndex + 1);

  if (!startStr || !endStr) {
    throw new Error("Both start and end times are required");
  }

  const startMs = parseSingleTime(startStr);
  const endMs = parseSingleTime(endStr);

  if (startMs >= endMs) {
    throw new Error("End time must be after start time");
  }

  return { startMs, endMs };
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
