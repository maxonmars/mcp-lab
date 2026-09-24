import type { DatabaseSync } from "node:sqlite";
import type { PollHistoryRow, PollResult } from "./types.ts";

export function insertPoll(db: DatabaseSync, scheduleId: string, requestedAtMs: number, result: PollResult): void {
  if (!result.ok) {
    db.prepare("INSERT INTO polls (schedule_id, requested_at_ms, ok, error) VALUES (?, ?, 0, ?)").run(
      scheduleId,
      requestedAtMs,
      result.error,
    );
    return;
  }
  const o = result.observation;
  db.prepare(
    `INSERT INTO polls (schedule_id, requested_at_ms, ok, observed_at_utc, observed_at_local, temperature,
       apparent_temperature, relative_humidity, precipitation, wind_speed, condition)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scheduleId,
    requestedAtMs,
    o.observedAtUtc,
    o.observedAtLocal,
    o.temperature,
    o.apparentTemperature,
    o.relativeHumidity,
    o.precipitation,
    o.windSpeed,
    o.condition,
  );
}

/** Границы включены: опрос ровно на границе периода входит в сводку. Порядок — по времени записи. */
export function pollsBetween(db: DatabaseSync, scheduleId: string, fromMs: number, toMs: number): PollHistoryRow[] {
  const rows = db
    .prepare(
      `SELECT requested_at_ms, ok, error, observed_at_utc, temperature, condition FROM polls
       WHERE schedule_id = ? AND requested_at_ms BETWEEN ? AND ? ORDER BY id`,
    )
    .all(scheduleId, fromMs, toMs);
  return rows.map((row) => ({
    requestedAtMs: row.requested_at_ms as number,
    ok: row.ok === 1,
    ...(row.error === null ? {} : { error: row.error as string }),
    ...(row.observed_at_utc === null ? {} : { observedAtUtc: row.observed_at_utc as string }),
    ...(row.temperature === null ? {} : { temperature: row.temperature as number }),
    ...(row.condition === null ? {} : { condition: row.condition as string }),
  }));
}
