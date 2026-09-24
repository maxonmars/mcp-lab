import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ScheduleRow } from "./types.ts";

type Raw = Record<string, unknown>;

const COLUMNS = `id, city, city_key, collect_every_seconds, summary_every_seconds, created_at_ms,
  next_collect_at_ms, next_summary_at_ms, latitude, longitude, location_name, cancelled_at_ms, last_summary_error`;

function toSchedule(raw: Raw): ScheduleRow {
  return {
    id: raw.id as string,
    city: raw.city as string,
    cityKey: raw.city_key as string,
    collectEverySeconds: raw.collect_every_seconds as number,
    summaryEverySeconds: raw.summary_every_seconds as number,
    createdAtMs: raw.created_at_ms as number,
    nextCollectAtMs: raw.next_collect_at_ms as number,
    nextSummaryAtMs: raw.next_summary_at_ms as number,
    latitude: raw.latitude as number | null,
    longitude: raw.longitude as number | null,
    locationName: raw.location_name as string | null,
    cancelledAtMs: raw.cancelled_at_ms as number | null,
    lastSummaryError: raw.last_summary_error as string | null,
  };
}

function query(db: DatabaseSync, where: string, ...params: SQLInputValue[]): ScheduleRow[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM schedules WHERE ${where} ORDER BY created_at_ms, id`).all(...params);
  return rows.map(toSchedule);
}

/** Регистр и лишние пробелы в названии города не различают расписания. */
export function cityKey(city: string): string {
  return city.normalize("NFC").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function insertSchedule(
  db: DatabaseSync,
  row: Omit<ScheduleRow, "latitude" | "longitude" | "locationName" | "cancelledAtMs" | "lastSummaryError">,
): void {
  db.prepare(
    `INSERT INTO schedules (id, city, city_key, collect_every_seconds, summary_every_seconds, created_at_ms,
       next_collect_at_ms, next_summary_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.city,
    row.cityKey,
    row.collectEverySeconds,
    row.summaryEverySeconds,
    row.createdAtMs,
    row.nextCollectAtMs,
    row.nextSummaryAtMs,
  );
}

export function getSchedule(db: DatabaseSync, id: string): ScheduleRow | undefined {
  return query(db, "id = ?", id)[0];
}

/** Название места без уточнения после запятой: «новосибирск, россия» → «новосибирск». */
const nameKey = (key: string): string => key.split(",")[0]?.trim() ?? key;

function matchesName(row: ScheduleRow, name: string): boolean {
  return nameKey(row.cityKey) === name || (row.locationName !== null && cityKey(row.locationName) === name);
}

/**
 * Расписания города: сначала точное совпадение строки, иначе совпадение названия без уточнения (в любую
 * сторону) или имени места, найденного Open‑Meteo. Активные предпочтительнее отменённых.
 */
export function findByCity(db: DatabaseSync, city: string): ScheduleRow[] {
  const key = cityKey(city);
  const all = query(db, "1 = 1");
  const exact = all.filter((row) => row.cityKey === key);
  const matches = exact.length > 0 ? exact : all.filter((row) => matchesName(row, nameKey(key)));
  const active = matches.filter((row) => row.cancelledAtMs === null);
  return active.length > 0 ? active : matches;
}

/** Все расписания для подсказки при «не найдено»: активные первыми, затем по времени создания. */
export function listKnown(db: DatabaseSync, limit: number): ScheduleRow[] {
  const all = query(db, "1 = 1");
  const rank = (row: ScheduleRow) => (row.cancelledAtMs === null ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

export function listActive(db: DatabaseSync): ScheduleRow[] {
  return query(db, "cancelled_at_ms IS NULL");
}

export function cancelSchedule(db: DatabaseSync, id: string, atMs: number): void {
  db.prepare("UPDATE schedules SET cancelled_at_ms = ? WHERE id = ?").run(atMs, id);
}

export function setNextCollect(db: DatabaseSync, id: string, nextMs: number): void {
  db.prepare("UPDATE schedules SET next_collect_at_ms = ? WHERE id = ? AND cancelled_at_ms IS NULL").run(nextMs, id);
}

export function setNextSummary(db: DatabaseSync, id: string, nextMs: number): void {
  db.prepare("UPDATE schedules SET next_summary_at_ms = ? WHERE id = ? AND cancelled_at_ms IS NULL").run(nextMs, id);
}

export function pinLocation(db: DatabaseSync, id: string, latitude: number, longitude: number, name: string): void {
  db.prepare("UPDATE schedules SET latitude = ?, longitude = ?, location_name = ? WHERE id = ?").run(
    latitude,
    longitude,
    name,
    id,
  );
}

export function setSummaryError(db: DatabaseSync, id: string, error: string | null, atMs: number | null): void {
  db.prepare("UPDATE schedules SET last_summary_error = ?, last_summary_error_at_ms = ? WHERE id = ?").run(
    error,
    atMs,
    id,
  );
}
