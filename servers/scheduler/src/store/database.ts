import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BUSY_TIMEOUT_MS = 5_000;
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  city_key TEXT NOT NULL,
  collect_every_seconds INTEGER NOT NULL,
  summary_every_seconds INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  next_collect_at_ms INTEGER NOT NULL,
  next_summary_at_ms INTEGER NOT NULL,
  latitude REAL,
  longitude REAL,
  location_name TEXT,
  cancelled_at_ms INTEGER,
  last_summary_error TEXT,
  last_summary_error_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS schedules_city_key ON schedules (city_key);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL REFERENCES schedules (id),
  requested_at_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  error TEXT,
  observed_at_utc TEXT,
  observed_at_local TEXT,
  temperature REAL,
  apparent_temperature REAL,
  relative_humidity REAL,
  precipitation REAL,
  wind_speed REAL,
  condition TEXT
);
CREATE INDEX IF NOT EXISTS polls_schedule_time ON polls (schedule_id, requested_at_ms);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL REFERENCES schedules (id),
  published_at_ms INTEGER NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  unique_observations INTEGER NOT NULL,
  markdown TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS summaries_schedule ON summaries (schedule_id, id);
`;

/** WAL позволяет читать из терминала B, пока worker пишет; busy_timeout заставляет ждать занятую базу. */
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  inTransaction(db, () => {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > SCHEMA_VERSION) throw new Error("SCHEMA_TOO_NEW");
    if (version < SCHEMA_VERSION) {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  });
  return db;
}

/** IMMEDIATE берёт блокировку записи сразу; транзакции короткие и не пересекают сетевые вызовы. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
