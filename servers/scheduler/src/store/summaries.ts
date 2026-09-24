import type { DatabaseSync } from "node:sqlite";
import type { SummaryRow } from "./types.ts";

export function insertSummary(db: DatabaseSync, row: Omit<SummaryRow, "id">): void {
  db.prepare(
    `INSERT INTO summaries (schedule_id, published_at_ms, period_start_ms, period_end_ms, unique_observations, markdown)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.scheduleId, row.publishedAtMs, row.periodStartMs, row.periodEndMs, row.uniqueObservations, row.markdown);
}

export function latestSummary(db: DatabaseSync, scheduleId: string): SummaryRow | undefined {
  const row = db
    .prepare(
      `SELECT id, schedule_id, published_at_ms, period_start_ms, period_end_ms, unique_observations, markdown
       FROM summaries WHERE schedule_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(scheduleId);
  if (!row) return undefined;
  return {
    id: row.id as number,
    scheduleId: row.schedule_id as string,
    publishedAtMs: row.published_at_ms as number,
    periodStartMs: row.period_start_ms as number,
    periodEndMs: row.period_end_ms as number,
    uniqueObservations: row.unique_observations as number,
    markdown: row.markdown as string,
  };
}
