import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { firstDailyDeadline, followingDailyDeadline } from "../service/dailyTime.ts";
import { getSchedule } from "../store/schedules.ts";
import { createHarness, type Harness, T0 } from "./harness.ts";

let harness: Harness;
afterEach(() => harness?.cleanup());

const DAILY = {
  city: "Новосибирск",
  collectEverySeconds: 900,
  summaryAtLocalTime: "18:00",
  timeZone: "Asia/Novosibirsk",
};
const FIRST = Date.parse("2026-09-24T11:00:00Z");
const SECOND = Date.parse("2026-09-25T11:00:00Z");

describe("ежедневные сроки", () => {
  it("назначает 18:00 Asia/Novosibirsk, сохраняет режим и сроки после перезапуска", () => {
    harness = createHarness();
    const initial = harness.open();
    const created = initial.createDailySchedule(DAILY);
    expect(created).toMatchObject({
      summaryMode: "daily",
      summaryAtLocalTime: "18:00",
      timeZone: "Asia/Novosibirsk",
      nextCollectAtMs: T0 + 900_000,
      nextSummaryAtMs: FIRST,
    });
    initial.close();
    const resumed = harness.open();
    expect(resumed.findSummary({ scheduleId: created.id })).toMatchObject({
      status: "no_summary",
      schedule: { nextSummaryAtMs: FIRST, summaryMode: "daily" },
    });
    expect(resumed.startWorker()).toBe("started");
    expect(resumed.dueTasks(FIRST - 1).tasks).toEqual([
      { scheduleId: created.id, city: DAILY.city, collectDue: true, summaryDue: false, summaryMode: "daily" },
    ]);
    expect(resumed.dueTasks(FIRST).tasks).toEqual([
      { scheduleId: created.id, city: DAILY.city, collectDue: true, summaryDue: true, summaryMode: "daily" },
    ]);
  });

  it("после публикации и после ошибки назначает следующий местный день, даже после долгого простоя", () => {
    harness = createHarness();
    const service = harness.open();
    expect(service.startWorker()).toBe("started");
    const schedule = service.createDailySchedule(DAILY);
    service.publishSummary({
      scheduleId: schedule.id,
      startedAtMs: FIRST,
      periodStartMs: FIRST - 86_400_000,
      periodEndMs: FIRST,
      uniqueObservations: 0,
      markdown: "# Первая",
    });
    expect(service.findSummary({ scheduleId: schedule.id })).toMatchObject({
      status: "found",
      schedule: { nextSummaryAtMs: SECOND },
    });

    const resumedAt = Date.parse("2026-09-28T12:00:00Z");
    expect(service.dueTasks(resumedAt).tasks).toMatchObject([{ summaryDue: true, summaryMode: "daily" }]);
    service.recordSummaryFailure({ scheduleId: schedule.id, startedAtMs: resumedAt, reason: "Модель не ответила." });
    expect(service.findSummary({ scheduleId: schedule.id })).toMatchObject({
      status: "found",
      summary: { markdown: "# Первая" },
      schedule: { nextSummaryAtMs: Date.parse("2026-09-29T11:00:00Z") },
    });
    expect(service.dueTasks(resumedAt).tasks).toMatchObject([{ summaryDue: false }]);
  });

  it("при повторе 01:30 осенью делает одну сводку за местную дату; пропущенное время весной переносит на завтра", () => {
    const zone = "America/New_York";
    const beforeRepeat = Date.parse("2026-11-01T04:30:00Z");
    const first = firstDailyDeadline(beforeRepeat, "01:30", zone);
    expect(first).toBe(Date.parse("2026-11-01T05:30:00Z"));
    expect(followingDailyDeadline(first, "01:30", zone)).toBe(Date.parse("2026-11-02T06:30:00Z"));
    expect(firstDailyDeadline(Date.parse("2026-11-01T05:45:00Z"), "01:30", zone)).toBe(
      Date.parse("2026-11-01T06:30:00Z"),
    );
    expect(firstDailyDeadline(Date.parse("2026-03-08T06:00:00Z"), "02:30", zone)).toBe(
      Date.parse("2026-03-09T06:30:00Z"),
    );
  });

  it("при создании ровно в 18:00 назначает следующий день", () => {
    expect(firstDailyDeadline(FIRST, "18:00", "Asia/Novosibirsk")).toBe(SECOND);
  });
});

describe("миграция SQLite v1", () => {
  it("сохраняет прежнее расписание и сводку, добавляя интервальный режим", () => {
    harness = createHarness();
    const legacy = new DatabaseSync(harness.dbPath);
    legacy.exec(`
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY, city TEXT NOT NULL, city_key TEXT NOT NULL,
        collect_every_seconds INTEGER NOT NULL, summary_every_seconds INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL, next_collect_at_ms INTEGER NOT NULL,
        next_summary_at_ms INTEGER NOT NULL, latitude REAL, longitude REAL,
        location_name TEXT, cancelled_at_ms INTEGER, last_summary_error TEXT,
        last_summary_error_at_ms INTEGER
      );
      CREATE TABLE summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT NOT NULL REFERENCES schedules (id),
        published_at_ms INTEGER NOT NULL, period_start_ms INTEGER NOT NULL,
        period_end_ms INTEGER NOT NULL, unique_observations INTEGER NOT NULL, markdown TEXT NOT NULL
      );
      CREATE TABLE polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT NOT NULL REFERENCES schedules (id),
        requested_at_ms INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0, 1)), error TEXT,
        observed_at_utc TEXT, observed_at_local TEXT, temperature REAL, apparent_temperature REAL,
        relative_humidity REAL, precipitation REAL, wind_speed REAL, condition TEXT
      );
      INSERT INTO schedules VALUES (
        'sch_legacy', 'Томск', 'томск', 900, 3600,
        ${T0}, ${T0 + 900_000}, ${T0 + 3_600_000}, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO summaries (schedule_id, published_at_ms, period_start_ms, period_end_ms,
        unique_observations, markdown) VALUES ('sch_legacy', ${T0}, 0, ${T0}, 1, '# Старый отчёт');
      INSERT INTO polls (schedule_id, requested_at_ms, ok, error)
        VALUES ('sch_legacy', ${T0}, 0, 'старая ошибка');
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const migrated = harness.open();
    expect(migrated.findSummary({ scheduleId: "sch_legacy" })).toMatchObject({
      status: "found",
      summary: { markdown: "# Старый отчёт" },
      schedule: { summaryMode: "interval", summaryAtLocalTime: null, timeZone: null, nextSummaryAtMs: T0 + 3_600_000 },
    });
    const db = new DatabaseSync(harness.dbPath);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(getSchedule(db, "sch_legacy")?.summaryEverySeconds).toBe(3600);
    db.close();
    expect(migrated.startWorker()).toBe("started");
    expect(migrated.dueTasks(T0 + 3_600_000).tasks).toEqual([
      { scheduleId: "sch_legacy", city: "Томск", collectDue: true, summaryDue: true },
    ]);
    expect(migrated.history("sch_legacy", T0, T0)).toEqual([{ requestedAtMs: T0, ok: false, error: "старая ошибка" }]);
    migrated.close();
    expect(harness.open().findSummary({ scheduleId: "sch_legacy" })).toMatchObject({
      status: "found",
      schedule: { summaryMode: "interval" },
    });
  });
});
