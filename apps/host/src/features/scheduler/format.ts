/** Время с точностью до секунды в ISO 8601 UTC: такой вид модель копирует и проверяется без разночтений. */
export function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

export function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function formatSigned(value: number): string {
  const text = formatNumber(value);
  return value > 0 ? `+${text}` : text;
}
