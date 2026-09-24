import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LOCATION_CHANGED_ERROR, MAX_KNOWN_SCHEDULES } from "../index.ts";
import { reportPath } from "../store/reportFile.ts";
import { createHarness, type Harness, observation, T0 } from "./harness.ts";

let harness: Harness;
afterEach(() => harness?.cleanup());

const SECOND = 1000;

function startedWorker(h: Harness) {
  const service = h.open();
  expect(service.startWorker()).toBe("started");
  return service;
}

describe("расписания", () => {
  it("первые сроки — createdAt + интервал, и расписание переживает перезапуск", () => {
    harness = createHarness();
    const first = harness.open();
    const created = first.createSchedule({ city: "  Новосибирск ", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(created).toMatchObject({ city: "Новосибирск", createdAtMs: T0 });
    expect(created.nextCollectAtMs).toBe(T0 + 10 * SECOND);
    expect(created.nextSummaryAtMs).toBe(T0 + 60 * SECOND);
    first.close();
    const second = harness.open();
    expect(second.findSummary({ scheduleId: created.id })).toMatchObject({
      status: "no_summary",
      schedule: { id: created.id, collectEverySeconds: 10, nextCollectAtMs: T0 + 10 * SECOND },
    });
  });

  it("название города хранится с одинарными пробелами: перевод строки не попадает в заголовок отчёта", () => {
    harness = createHarness();
    const service = harness.open();
    const created = service.createSchedule({
      city: " Нижний\n  Новгород ",
      collectEverySeconds: 10,
      summaryEverySeconds: 60,
    });
    expect(created.city).toBe("Нижний Новгород");
    expect(service.findSummary({ city: "нижний новгород" })).toMatchObject({ status: "no_summary" });
  });

  it("чтение по городу не различает регистр и пробелы; несколько расписаний возвращают ID", () => {
    harness = createHarness();
    const service = harness.open();
    const first = service.createSchedule({ city: "Новосибирск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(service.findSummary({ city: "  новосибирск " })).toMatchObject({ status: "no_summary" });
    const second = service.createSchedule({ city: "НОВОСИБИРСК", collectEverySeconds: 900, summaryEverySeconds: 3600 });
    const found = service.findSummary({ city: "Новосибирск" });
    expect(found.status).toBe("ambiguous");
    if (found.status === "ambiguous") {
      expect(found.candidates.map((item) => item.schedule.id)).toEqual([first.id, second.id]);
    }
    for (const query of [{ city: "Омск" }, { scheduleId: "sch_ffffffff" }]) {
      const missing = service.findSummary(query);
      expect(missing.status).toBe("not_found");
      if (missing.status === "not_found")
        expect(missing.known.map((item) => item.schedule.id)).toEqual([first.id, second.id]);
    }
  });

  it("отмена прекращает будущие запуски, сохраняет историю и сводку; по городу остаётся единственное расписание", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Омск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    harness.clock.now = T0 + 10 * SECOND;
    service.recordPoll({
      scheduleId: schedule.id,
      requestedAtMs: harness.clock.now,
      result: { ok: true, observation: observation() },
    });
    service.publishSummary({
      scheduleId: schedule.id,
      startedAtMs: harness.clock.now,
      periodStartMs: T0 - 86_400_000,
      periodEndMs: harness.clock.now,
      uniqueObservations: 1,
      markdown: "# Омск",
    });
    expect(service.cancel(schedule.id)).toEqual({ status: "cancelled" });
    expect(service.cancel(schedule.id)).toEqual({ status: "already_cancelled" });
    expect(service.cancel("sch_ffffffff")).toEqual({ status: "not_found" });
    expect(service.dueTasks(T0 + 10 * 86_400_000)).toEqual({ tasks: [], nextDueAtMs: null });
    expect(service.history(schedule.id, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
    expect(service.findSummary({ city: "Омск" })).toMatchObject({ status: "found", summary: { markdown: "# Омск" } });
  });

  it("служебные операции недоступны без worker_start", () => {
    harness = createHarness();
    const service = harness.open();
    expect(() => service.dueTasks(T0)).toThrow(expect.objectContaining({ code: "WORKER_NOT_STARTED" }));
    expect(() => service.history("sch_1", 0, 1)).toThrow(expect.objectContaining({ code: "WORKER_NOT_STARTED" }));
  });
});

describe("сопоставление города при чтении", () => {
  const create = (service: ReturnType<Harness["open"]>, city: string) =>
    service.createSchedule({ city, collectEverySeconds: 10, summaryEverySeconds: 60 });
  const statusOf = (service: ReturnType<Harness["open"]>, city: string) => service.findSummary({ city }).status;

  it("расписание «Новосибирск, Россия» находится по названию без страны, но не по другой словоформе", () => {
    harness = createHarness();
    const service = harness.open();
    create(service, "Новосибирск, Россия");
    expect(statusOf(service, "Новосибирск, Россия")).toBe("no_summary");
    expect(statusOf(service, "Новосибирск")).toBe("no_summary");
    expect(statusOf(service, "  НОВОСИБИРСК ")).toBe("no_summary");
    expect(statusOf(service, "Новосибирске")).toBe("not_found");
  });

  it("расписание «Новосибирск» находится по запросу со страной", () => {
    harness = createHarness();
    const service = harness.open();
    create(service, "Новосибирск");
    expect(statusOf(service, "Новосибирск, Россия")).toBe("no_summary");
  });

  it("точное совпадение важнее совпадения по названию; при равных названиях просят выбрать ID", () => {
    harness = createHarness();
    const service = harness.open();
    const russia = create(service, "Москва, Россия");
    create(service, "Москва, Айдахо");
    const exact = service.findSummary({ city: "Москва, Россия" });
    expect(exact).toMatchObject({ status: "no_summary", schedule: { id: russia.id } });
    expect(statusOf(service, "Москва")).toBe("ambiguous");
    expect(statusOf(service, "Москва, США")).toBe("ambiguous");
  });

  it("находит по имени места, которое вернул Open-Meteo при закреплении точки", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = create(service, "Novosibirsk");
    expect(statusOf(service, "Новосибирск")).toBe("not_found");
    service.recordPoll({
      scheduleId: schedule.id,
      requestedAtMs: T0 + 10 * SECOND,
      result: { ok: true, observation: observation() },
    });
    expect(service.findSummary({ city: "Новосибирск" })).toMatchObject({
      status: "no_summary",
      schedule: { id: schedule.id },
    });
  });

  it("активное расписание предпочтительнее отменённого с тем же названием", () => {
    harness = createHarness();
    const service = harness.open();
    const old = create(service, "Омск, Россия");
    service.cancel(old.id);
    expect(service.findSummary({ city: "Омск" })).toMatchObject({ status: "no_summary", schedule: { id: old.id } });
    const fresh = create(service, "Омск");
    expect(service.findSummary({ city: "Омск" })).toMatchObject({ status: "no_summary", schedule: { id: fresh.id } });
  });

  it("при «не найдено» подсказка содержит активные расписания первыми и не длиннее MAX_KNOWN_SCHEDULES", () => {
    harness = createHarness();
    const service = harness.open();
    const cancelled = create(service, "Город 0");
    service.cancel(cancelled.id);
    for (let index = 1; index <= MAX_KNOWN_SCHEDULES + 2; index++) create(service, `Город ${index}`);
    const missing = service.findSummary({ city: "Неизвестный" });
    if (missing.status !== "not_found") throw new Error("ожидалось not_found");
    expect(missing.known).toHaveLength(MAX_KNOWN_SCHEDULES);
    expect(missing.known.every((item) => item.schedule.cancelledAtMs === null)).toBe(true);
  });
});

describe("сроки и опросы", () => {
  it("dueTasks показывает наступившие сроки и ближайший срок", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(service.dueTasks(T0 + 9_999)).toEqual({ tasks: [], nextDueAtMs: T0 + 10 * SECOND });
    expect(service.dueTasks(T0 + 10 * SECOND).tasks).toEqual([
      { scheduleId: schedule.id, city: "Томск", collectDue: true, summaryDue: false },
    ]);
    expect(service.dueTasks(T0 + 60 * SECOND).tasks[0]).toMatchObject({ collectDue: true, summaryDue: true });
  });

  it("после простоя просроченный опрос выполняется один раз, следующий срок — от фактического выполнения", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    const resumedAt = T0 + 3_600 * SECOND;
    expect(service.dueTasks(resumedAt).tasks).toHaveLength(1);
    service.recordPoll({
      scheduleId: schedule.id,
      requestedAtMs: resumedAt,
      result: { ok: true, observation: observation() },
    });
    expect(service.dueTasks(resumedAt).tasks).toEqual([
      { scheduleId: schedule.id, city: "Томск", collectDue: false, summaryDue: true },
    ]);
    expect(service.dueTasks(resumedAt + 10 * SECOND - 1).tasks.some((task) => task.collectDue)).toBe(false);
    expect(service.dueTasks(resumedAt + 10 * SECOND).tasks.some((task) => task.collectDue)).toBe(true);
    expect(service.history(schedule.id, T0, resumedAt + 60 * SECOND)).toHaveLength(1);
  });

  it("опоздание на несколько секунд начинает отсчёт от фактического запуска", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 600 });
    service.recordPoll({
      scheduleId: schedule.id,
      requestedAtMs: T0 + 13 * SECOND,
      result: { ok: false, error: "сбой" },
    });
    expect(service.dueTasks(T0).nextDueAtMs).toBe(T0 + 23 * SECOND);
  });

  it("при небольшой задержке сетка сроков не дрейфует", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 600 });
    service.recordPoll({ scheduleId: schedule.id, requestedAtMs: T0 + 10_400, result: { ok: false, error: "сбой" } });
    expect(service.dueTasks(T0).nextDueAtMs).toBe(T0 + 20 * SECOND);
  });

  it("закрепляет точку по первому успеху; другая точка записывается ошибкой и не считается наблюдением", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    const poll = (atMs: number, result: Parameters<typeof service.recordPoll>[0]["result"]) =>
      service.recordPoll({ scheduleId: schedule.id, requestedAtMs: atMs, result });
    expect(poll(T0 + 10 * SECOND, { ok: false, error: "сеть" })).toEqual({ locationChanged: false });
    expect(poll(T0 + 20 * SECOND, { ok: true, observation: observation() })).toEqual({ locationChanged: false });
    const moved = observation({ latitude: 56.5, longitude: 84.97, observedAtUtc: "2026-09-24T10:15:00Z" });
    expect(poll(T0 + 30 * SECOND, { ok: true, observation: moved })).toEqual({ locationChanged: true });
    const history = service.history(schedule.id, T0, T0 + 60 * SECOND);
    expect(history.map((row) => row.ok)).toEqual([false, true, false]);
    expect(history[2]).toEqual({ requestedAtMs: T0 + 30 * SECOND, ok: false, error: LOCATION_CHANGED_ERROR });
  });

  it("история включает обе границы периода и идёт в порядке записи", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    for (const seconds of [0, 10, 20, 30]) {
      const requestedAtMs = T0 + seconds * SECOND;
      service.recordPoll({ scheduleId: schedule.id, requestedAtMs, result: { ok: true, observation: observation() } });
    }
    const rows = service.history(schedule.id, T0 + 10 * SECOND, T0 + 30 * SECOND);
    expect(rows.map((row) => row.requestedAtMs)).toEqual([10, 20, 30].map((s) => T0 + s * SECOND));
    expect(rows[0]).toMatchObject({
      ok: true,
      observedAtUtc: "2026-09-24T10:00:00Z",
      temperature: 12,
      condition: "пасмурно",
    });
  });
});

describe("опубликованные сводки", () => {
  const publish = (service: ReturnType<typeof startedWorker>, id: string, markdown: string, atMs = T0 + 60 * SECOND) =>
    service.publishSummary({
      scheduleId: id,
      startedAtMs: atMs,
      periodStartMs: atMs - 86_400_000,
      periodEndMs: atMs,
      uniqueObservations: 3,
      markdown,
    });

  it("хранит текст в SQLite и в .md, читается после перезапуска и заменяется новой публикацией", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(publish(service, schedule.id, "# Первая")).toEqual({ fileSynced: true });
    expect(readFileSync(reportPath(harness.reportsDir, schedule.id), "utf8")).toBe("# Первая");
    publish(service, schedule.id, "# Вторая", T0 + 120 * SECOND);
    service.close();
    const found = harness.open().findSummary({ scheduleId: schedule.id });
    expect(found).toMatchObject({ status: "found", summary: { markdown: "# Вторая", uniqueObservations: 3 } });
    const db = new DatabaseSync(harness.dbPath);
    expect(db.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(2);
    db.close();
  });

  it("ошибка публикации сохраняет прежнюю сводку, фиксирует причину и сдвигает срок без повторного запуска", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    publish(service, schedule.id, "# Прежняя");
    const failedAt = T0 + 3_600 * SECOND;
    service.recordSummaryFailure({ scheduleId: schedule.id, startedAtMs: failedAt, reason: "Пустой ответ модели." });
    expect(service.findSummary({ scheduleId: schedule.id })).toMatchObject({
      status: "found",
      summary: { markdown: "# Прежняя" },
      schedule: { lastSummaryError: "Пустой ответ модели.", nextSummaryAtMs: failedAt + 60 * SECOND },
    });
    expect(service.dueTasks(failedAt).tasks.some((task) => task.summaryDue)).toBe(false);
    publish(service, schedule.id, "# Новая", failedAt + 60 * SECOND);
    expect(service.findSummary({ scheduleId: schedule.id })).toMatchObject({ schedule: { lastSummaryError: null } });
  });

  it("отсутствующая или устаревшая копия .md восстанавливается из SQLite при чтении", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    publish(service, schedule.id, "# Из базы");
    const path = reportPath(harness.reportsDir, schedule.id);
    rmSync(path);
    service.findSummary({ scheduleId: schedule.id });
    expect(readFileSync(path, "utf8")).toBe("# Из базы");
    writeFileSync(path, "# Устаревшая копия");
    expect(service.findSummary({ city: "Томск" })).toMatchObject({ summary: { markdown: "# Из базы" } });
    expect(readFileSync(path, "utf8")).toBe("# Из базы");
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("сбой записи .md не отменяет публикацию: SQLite остаётся источником", () => {
    harness = createHarness();
    const service = startedWorker(harness);
    const schedule = service.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    writeFileSync(harness.reportsDir, "это файл, а не каталог");
    expect(publish(service, schedule.id, "# Только в базе")).toEqual({ fileSynced: false });
    expect(service.findSummary({ scheduleId: schedule.id })).toMatchObject({
      summary: { markdown: "# Только в базе" },
    });
  });

  it("после очистки базы оставшийся .md не выдаётся как актуальная сводка", () => {
    harness = createHarness();
    const same = () => "sch_00000001";
    const before = harness.open(same);
    before.startWorker();
    before.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    publish(before, "sch_00000001", "# Старая сводка");
    before.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${harness.dbPath}${suffix}`, { force: true });
    expect(existsSync(reportPath(harness.reportsDir, "sch_00000001"))).toBe(true);

    const after = harness.open(same);
    expect(after.findSummary({ scheduleId: "sch_00000001" })).toEqual({ status: "not_found", known: [] });
    expect(after.findSummary({ city: "Томск" })).toEqual({ status: "not_found", known: [] });
    after.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(after.findSummary({ scheduleId: "sch_00000001" })).toMatchObject({ status: "no_summary" });
  });
});

describe("несколько подключений к одной базе", () => {
  it("расписание из одного подключения сразу видно другому, worker занимается один", () => {
    harness = createHarness();
    mkdirSync(harness.reportsDir, { recursive: true });
    const worker = harness.open();
    const user = harness.open();
    expect(worker.startWorker()).toBe("started");
    expect(worker.startWorker()).toBe("started");
    expect(harness.open().startWorker()).toBe("already_running");
    const schedule = user.createSchedule({ city: "Томск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(worker.dueTasks(T0 + 10 * SECOND).tasks.map((task) => task.scheduleId)).toEqual([schedule.id]);
    worker.close();
    expect(harness.open().startWorker()).toBe("started");
  });
});
