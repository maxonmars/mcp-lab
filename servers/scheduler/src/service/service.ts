import type { DatabaseSync } from "node:sqlite";
import { inTransaction, openDatabase } from "../store/database.ts";
import { insertPoll, pollsBetween } from "../store/polls.ts";
import { reportPath, syncReportFile } from "../store/reportFile.ts";
import {
  cancelSchedule,
  cityKey,
  findByCity,
  getSchedule,
  insertSchedule,
  listActive,
  listKnown,
  pinLocation,
  setNextCollect,
  setNextSummary,
  setSummaryError,
} from "../store/schedules.ts";
import { insertSummary, latestSummary } from "../store/summaries.ts";
import type { PollHistoryRow, ScheduleRow } from "../store/types.ts";
import { WorkerLock } from "../store/workerLock.ts";
import { nextDeadline } from "./deadlines.ts";
import { ServiceError } from "./errors.ts";
import type {
  CancelOutcome,
  DueTasks,
  NewSchedule,
  PollInput,
  PollOutcome,
  PublishInput,
  PublishOutcome,
  ServiceDeps,
  SummaryFailureInput,
  SummaryLookup,
  SummaryQuery,
} from "./types.ts";

/** Сколько существующих расписаний показывать в ответе «не найдено». */
export const MAX_KNOWN_SCHEDULES = 10;

export const LOCATION_CHANGED_ERROR = "Геокодирование вернуло другую точку, чем при первом опросе.";

/** База открывается при первом обращении: пробный процесс согласования версии MCP не трогает файлы. */
export class SchedulerService {
  readonly #deps: ServiceDeps;
  #db: DatabaseSync | undefined;
  #lock: WorkerLock | undefined;

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
  }

  get #database(): DatabaseSync {
    this.#db ??= openDatabase(this.#deps.dbPath);
    return this.#db;
  }

  createSchedule(input: NewSchedule): ScheduleRow {
    const now = this.#deps.now();
    const city = input.city.trim().replaceAll(/\s+/g, " ");
    const row = {
      id: this.#deps.newId(),
      city,
      cityKey: cityKey(city),
      collectEverySeconds: input.collectEverySeconds,
      summaryEverySeconds: input.summaryEverySeconds,
      createdAtMs: now,
      nextCollectAtMs: now + input.collectEverySeconds * 1000,
      nextSummaryAtMs: now + input.summaryEverySeconds * 1000,
    };
    const db = this.#database;
    inTransaction(db, () => insertSchedule(db, row));
    return { ...row, latitude: null, longitude: null, locationName: null, cancelledAtMs: null, lastSummaryError: null };
  }

  /** Источник текста — SQLite; `.md` при чтении лишь восстанавливается из него и сам не читается как данные. */
  findSummary(query: SummaryQuery): SummaryLookup {
    const db = this.#database;
    const matches = query.scheduleId
      ? [getSchedule(db, query.scheduleId)].filter((row): row is ScheduleRow => row !== undefined)
      : findByCity(db, query.city ?? "");
    const [only, ...others] = matches;
    if (!only) return { status: "not_found", known: this.#candidates(db, listKnown(db, MAX_KNOWN_SCHEDULES)) };
    if (others.length > 0) return { status: "ambiguous", candidates: this.#candidates(db, matches) };
    const summary = latestSummary(db, only.id);
    if (!summary) return { status: "no_summary", schedule: only };
    syncReportFile(reportPath(this.#deps.reportsDir, only.id), summary.markdown);
    return { status: "found", schedule: only, summary };
  }

  cancel(scheduleId: string): CancelOutcome {
    const db = this.#database;
    return inTransaction(db, () => {
      const schedule = getSchedule(db, scheduleId);
      if (!schedule) return { status: "not_found" };
      if (schedule.cancelledAtMs !== null) return { status: "already_cancelled" };
      cancelSchedule(db, scheduleId, this.#deps.now());
      return { status: "cancelled" };
    });
  }

  startWorker(): "started" | "already_running" {
    if (this.#lock) return "started";
    const lock = WorkerLock.acquire(this.#deps.dbPath);
    if (!lock) return "already_running";
    this.#lock = lock;
    return "started";
  }

  dueTasks(nowMs: number): DueTasks {
    this.#requireWorker();
    const active = listActive(this.#database);
    const tasks = active
      .map((row) => ({
        scheduleId: row.id,
        city: row.city,
        collectDue: row.nextCollectAtMs <= nowMs,
        summaryDue: row.nextSummaryAtMs <= nowMs,
      }))
      .filter((task) => task.collectDue || task.summaryDue);
    const deadlines = active.flatMap((row) => [row.nextCollectAtMs, row.nextSummaryAtMs]);
    return { tasks, nextDueAtMs: deadlines.length > 0 ? Math.min(...deadlines) : null };
  }

  /** Другая точка геокодирования, чем закреплена по первому успеху, записывается как ошибка опроса. */
  recordPoll(input: PollInput): PollOutcome {
    this.#requireWorker();
    const db = this.#database;
    return inTransaction(db, () => {
      const schedule = this.#requireSchedule(db, input.scheduleId);
      let stored = input.result;
      let locationChanged = false;
      if (stored.ok) {
        const { latitude, longitude, locationName } = stored.observation;
        if (schedule.latitude === null) pinLocation(db, schedule.id, latitude, longitude, locationName);
        else if (schedule.latitude !== latitude || schedule.longitude !== longitude) {
          stored = { ok: false, error: LOCATION_CHANGED_ERROR };
          locationChanged = true;
        }
      }
      insertPoll(db, schedule.id, input.requestedAtMs, stored);
      setNextCollect(
        db,
        schedule.id,
        nextDeadline(schedule.nextCollectAtMs, schedule.collectEverySeconds, input.requestedAtMs),
      );
      return { locationChanged };
    });
  }

  history(scheduleId: string, fromMs: number, toMs: number): PollHistoryRow[] {
    this.#requireWorker();
    return pollsBetween(this.#database, scheduleId, fromMs, toMs);
  }

  /** Сначала фиксируется SQLite, затем копия `.md`: сбой файла не отменяет публикацию и чинится при чтении. */
  publishSummary(input: PublishInput): PublishOutcome {
    this.#requireWorker();
    const db = this.#database;
    inTransaction(db, () => {
      const schedule = this.#requireSchedule(db, input.scheduleId);
      insertSummary(db, {
        scheduleId: schedule.id,
        publishedAtMs: this.#deps.now(),
        periodStartMs: input.periodStartMs,
        periodEndMs: input.periodEndMs,
        uniqueObservations: input.uniqueObservations,
        markdown: input.markdown,
      });
      setNextSummary(
        db,
        schedule.id,
        nextDeadline(schedule.nextSummaryAtMs, schedule.summaryEverySeconds, input.startedAtMs),
      );
      setSummaryError(db, schedule.id, null, null);
    });
    return { fileSynced: syncReportFile(reportPath(this.#deps.reportsDir, input.scheduleId), input.markdown) };
  }

  /** Срок публикации сдвигается и при ошибке: повторный платный запрос к модели сразу не выполняется. */
  recordSummaryFailure(input: SummaryFailureInput): void {
    this.#requireWorker();
    const db = this.#database;
    inTransaction(db, () => {
      const schedule = this.#requireSchedule(db, input.scheduleId);
      setSummaryError(db, schedule.id, input.reason, this.#deps.now());
      setNextSummary(
        db,
        schedule.id,
        nextDeadline(schedule.nextSummaryAtMs, schedule.summaryEverySeconds, input.startedAtMs),
      );
    });
  }

  close(): void {
    this.#lock?.release();
    this.#db?.close();
    this.#lock = undefined;
    this.#db = undefined;
  }

  #candidates(db: DatabaseSync, schedules: readonly ScheduleRow[]) {
    return schedules.map((schedule) => ({
      schedule,
      publishedAtMs: latestSummary(db, schedule.id)?.publishedAtMs ?? null,
    }));
  }

  #requireWorker(): void {
    if (!this.#lock) throw new ServiceError("WORKER_NOT_STARTED");
  }

  #requireSchedule(db: DatabaseSync, id: string): ScheduleRow {
    const schedule = getSchedule(db, id);
    if (!schedule) throw new ServiceError("SCHEDULE_NOT_FOUND");
    return schedule;
  }
}
