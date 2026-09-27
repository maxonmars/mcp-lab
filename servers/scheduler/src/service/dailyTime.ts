const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type LocalParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function localParts(format: Intl.DateTimeFormat, instantMs: number): LocalParts {
  const fields = Object.fromEntries(format.formatToParts(new Date(instantMs)).map(({ type, value }) => [type, value]));
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

function offsetAt(format: Intl.DateTimeFormat, instantMs: number): number {
  const local = localParts(format, instantMs);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instantMs;
}

function matchingInstants(format: Intl.DateTimeFormat, wallUtcMs: number): number[] {
  const desired = new Date(wallUtcMs);
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour++) offsets.add(offsetAt(format, wallUtcMs + hour * HOUR_MS));
  return [...offsets]
    .map((offset) => wallUtcMs - offset)
    .filter((instantMs) => {
      const actual = localParts(format, instantMs);
      return (
        actual.year === desired.getUTCFullYear() &&
        actual.month === desired.getUTCMonth() + 1 &&
        actual.day === desired.getUTCDate() &&
        actual.hour === desired.getUTCHours() &&
        actual.minute === desired.getUTCMinutes() &&
        actual.second === 0
      );
    });
}

function dailyDeadline(afterMs: number, atLocalTime: string, timeZone: string, nextDayOnly: boolean): number {
  if (!isValidLocalTime(atLocalTime)) throw new Error("INVALID_LOCAL_TIME");
  const format = formatter(timeZone);
  const local = localParts(format, afterMs);
  const hour = Number(atLocalTime.slice(0, 2));
  const minute = Number(atLocalTime.slice(3, 5));
  const localDayUtc = Date.UTC(local.year, local.month - 1, local.day);
  for (let day = nextDayOnly ? 1 : 0; day < 7; day++) {
    const wallUtcMs = localDayUtc + day * DAY_MS + hour * HOUR_MS + minute * 60_000;
    const next = matchingInstants(format, wallUtcMs)
      .filter((instantMs) => instantMs > afterMs)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) return next;
  }
  throw new Error("LOCAL_DAILY_TIME_NOT_FOUND");
}

/** Первое наступление местного времени строго после создания расписания. */
export function firstDailyDeadline(createdAtMs: number, atLocalTime: string, timeZone: string): number {
  return dailyDeadline(createdAtMs, atLocalTime, timeZone, false);
}

/** После попытки сводки следующая публикация приходится на другую местную календарную дату. */
export function followingDailyDeadline(startedAtMs: number, atLocalTime: string, timeZone: string): number {
  return dailyDeadline(startedAtMs, atLocalTime, timeZone, true);
}

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.startsWith("+") || timeZone.startsWith("-")) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalTime(atLocalTime: string): boolean {
  return LOCAL_TIME_PATTERN.test(atLocalTime);
}
