const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** localTime — ISO 8601 без смещения из `current.time`, offsetSeconds — `utc_offset_seconds` того же ответа. */
export function toUtcTime(localTime: string, offsetSeconds: number): string | undefined {
  const match = LOCAL_TIME.exec(localTime);
  if (!match || !Number.isInteger(offsetSeconds)) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(localAsUtc - offsetSeconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(".000Z", "Z");
}
