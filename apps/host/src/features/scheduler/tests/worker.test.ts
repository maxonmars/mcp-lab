import { describe, expect, it } from "vitest";
import { AgentError, type ModelCompletion } from "../../../core/index.ts";
import { SchedulerError } from "../errors.ts";
import {
  FakeModel,
  FakeScheduler,
  FakeWeather,
  goodReply,
  MODEL_TEXT,
  observation,
  runScenario,
  SECOND,
  T0,
  userMessage,
} from "./support.ts";

function schedulerWithSchedule(collect = 10, summary = 60): FakeScheduler {
  const scheduler = new FakeScheduler();
  scheduler.addSchedule(T0, collect, summary);
  return scheduler;
}

describe("worker: расписание 10/60 секунд", () => {
  it("за первую минуту — шесть опросов и один вызов модели; опрос на границе входит в сводку", async () => {
    const scheduler = schedulerWithSchedule();
    const { model, events } = await runScenario({ scheduler, endAt: T0 + 60 * SECOND });

    expect(scheduler.polls.map((poll) => poll.requestedAtMs)).toEqual(
      [10, 20, 30, 40, 50, 60].map((s) => T0 + s * SECOND),
    );
    expect(model.requests).toHaveLength(1);
    const request = model.requests[0];
    expect(request?.tools).toEqual([]);
    expect(request?.toolChoice).toBe("none");
    expect(request?.messages[0]).toEqual({ role: "system", content: "SYSTEM-PROMPT" });
    expect(userMessage(request as never)).toContain("Запросов за период: 6 (успешных: 6, с ошибкой: 0)");
    expect(scheduler.summaries).toHaveLength(1);
    expect(events.reports).toHaveLength(1);
  });

  it("если сроки совпали, сначала сохраняется опрос, затем составляется сводка, и печать идёт после сохранения", async () => {
    const scheduler = schedulerWithSchedule();
    await runScenario({ scheduler, endAt: T0 + 60 * SECOND });
    const tail = scheduler.log.slice(-5);
    expect(tail).toEqual(["poll", "history", "publish", "report", "stopped"]);
  });

  it("отчёт содержит реальный текст модели, период и число наблюдений и печатается без реплики пользователя", async () => {
    const scheduler = schedulerWithSchedule();
    const { events } = await runScenario({ scheduler, endAt: T0 + 60 * SECOND });
    const [report] = events.reports;
    expect(report?.markdown).toContain(MODEL_TEXT);
    expect(report?.markdown).toContain("Период (UTC): 2026-09-23T10:01:00Z — 2026-09-24T10:01:00Z");
    expect(report?.markdown).toContain("Уникальных наблюдений: 1");
    expect(report?.markdown).toMatch(/^---\nscheduleId: sch_00000001\ncity: Новосибирск\n/);
    expect(report?.markdown).toContain("# Сводка погоды: Новосибирск");
    expect(report?.markdown).toContain("requests: 6");
    expect(report?.markdown).toBe(scheduler.summaries[0]);
    expect(report).toMatchObject({ scheduleId: "sch_00000001", city: "Новосибирск", fileSynced: true });
  });

  it("шесть ответов с одним временем наблюдения — шесть запросов и одно уникальное наблюдение", async () => {
    const scheduler = schedulerWithSchedule();
    const { model } = await runScenario({ scheduler, endAt: T0 + 60 * SECOND });
    const prompt = userMessage(model.requests[0] as never);
    expect(prompt).toContain("Запросов за период: 6");
    expect(prompt).toContain("Уникальных наблюдений: 1");
    expect(prompt).toContain("изменение 0 °C");
    expect(prompt).toContain("среднее 12 °C");
    expect(scheduler.polls).toHaveLength(6);
  });

  it("температура считается по последнему ответу каждого слота: изменение и среднее по уникальным слотам", async () => {
    const scheduler = schedulerWithSchedule();
    const slots = [
      { observedAtUtc: "2026-09-24T10:00:00Z", temperature: 10 },
      { observedAtUtc: "2026-09-24T10:00:00Z", temperature: 11 },
      { observedAtUtc: "2026-09-24T10:00:00Z", temperature: 11 },
      { observedAtUtc: "2026-09-24T10:15:00Z", temperature: 14 },
      { observedAtUtc: "2026-09-24T10:15:00Z", temperature: 14 },
      { observedAtUtc: "2026-09-24T10:15:00Z", temperature: 15 },
    ];
    const weather = new FakeWeather((call) => ({ ok: true, observation: observation(slots[call - 1]) }));
    const { model } = await runScenario({ scheduler, weather, endAt: T0 + 60 * SECOND });
    const prompt = userMessage(model.requests[0] as never);
    expect(prompt).toContain("Запросов за период: 6");
    expect(prompt).toContain("Уникальных наблюдений: 2");
    expect(prompt).toContain("первая 11 °C, последняя 15 °C, изменение +4 °C");
    expect(prompt).toContain("среднее 13 °C");
  });

  it("ошибки опросов сохраняются с причиной, температурные показатели не выдумываются", async () => {
    const scheduler = schedulerWithSchedule();
    const weather = new FakeWeather(() => ({
      ok: false,
      error: "Место не найдено сервисом геокодирования Open-Meteo.",
    }));
    const { model, events } = await runScenario({ scheduler, weather, endAt: T0 + 60 * SECOND });
    expect(scheduler.polls.every((poll) => !poll.ok && poll.error?.includes("не найдено"))).toBe(true);
    const prompt = userMessage(model.requests[0] as never);
    expect(prompt).toContain("Запросов за период: 6 (успешных: 0, с ошибкой: 6)");
    expect(prompt).toContain("Температура: данных нет");
    expect(prompt).not.toContain("минимум");
    expect(prompt).toContain("Место не найдено сервисом геокодирования Open-Meteo. — 6");
    expect(events.reports[0]?.markdown).toContain("uniqueObservations: 0");
  });

  it("неожиданное исключение опроса записывается как ошибка опроса, цикл продолжается", async () => {
    const scheduler = schedulerWithSchedule(10, 3600);
    const weather = new FakeWeather(() => Promise.reject(new Error("секрет-токен")));
    await runScenario({ scheduler, weather, endAt: T0 + 20 * SECOND });
    expect(scheduler.polls).toHaveLength(2);
    expect(JSON.stringify(scheduler.polls)).not.toContain("секрет-токен");
    expect(scheduler.polls[0]).toMatchObject({ ok: false, error: "Опрос погоды завершился непредвиденной ошибкой." });
  });

  it("в запрос к модели не попадают все сырые строки: число примеров ограничено", async () => {
    const scheduler = schedulerWithSchedule(5, 600);
    const weather = new FakeWeather((call) => ({
      ok: true,
      observation: observation({
        observedAtUtc: new Date(T0 + call * 900 * SECOND).toISOString().replace(".000Z", "Z"),
        temperature: call,
      }),
    }));
    const { model } = await runScenario({ scheduler, weather, endAt: T0 + 600 * SECOND });
    const prompt = userMessage(model.requests[0] as never);
    expect(prompt).toContain("Уникальных наблюдений: 120");
    expect(prompt).toContain("Примеры наблюдений (показано 8 из 120)");
    expect(prompt.split("\n").filter((line) => line.startsWith("- 2026-")).length).toBe(8);
    expect(prompt).not.toContain("{");
  });
});

describe("worker: простой, ожидание и остановка", () => {
  it("после простоя просроченные опрос и сводка выполняются по одному разу, без догоняющих вызовов", async () => {
    const scheduler = schedulerWithSchedule();
    const { model } = await runScenario({
      scheduler,
      startAt: T0 + 3 * 3600 * SECOND,
      endAt: T0 + 3 * 3600 * SECOND + 5 * SECOND,
    });
    expect(scheduler.polls).toHaveLength(1);
    expect(model.requests).toHaveLength(1);
    expect(scheduler.polls[0]?.requestedAtMs).toBe(T0 + 3 * 3600 * SECOND);
    expect(scheduler.schedules[0]?.nextCollectAtMs).toBe(T0 + 3 * 3600 * SECOND + 10 * SECOND);
  });

  it("без расписаний worker не занят: ожидание не длиннее MAX_IDLE_WAIT_MS", async () => {
    const { clock, scheduler } = await runScenario({ endAt: T0 + 5 * SECOND });
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(1000);
    expect(scheduler.polls).toEqual([]);
  });

  it("второй worker получает отказ до начала работы", async () => {
    const scheduler = schedulerWithSchedule();
    scheduler.alreadyRunning = true;
    const weather = new FakeWeather();
    await expect(runScenario({ scheduler, weather, endAt: T0 + 60 * SECOND })).rejects.toMatchObject({
      code: "WORKER_ALREADY_RUNNING",
    });
    expect(scheduler.log).toEqual([]);
    expect(weather.cities).toEqual([]);
  });

  it("ошибка хранилища завершает цикл исключением, событие остановки всё равно приходит", async () => {
    const scheduler = schedulerWithSchedule();
    scheduler.dueError = new SchedulerError("TIMEOUT", "scheduler");
    await expect(runScenario({ scheduler, endAt: T0 + 60 * SECOND })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(scheduler.log).toEqual(["start", "started", "stopped"]);
  });
});

describe("worker: некорректный ответ модели", () => {
  const cases: [string, (request: Parameters<FakeModel["complete"]>[0]) => ModelCompletion, string][] = [
    ["пустой текст", () => ({ type: "text", content: "  \n " }), "Модель вернула пустой ответ."],
    [
      "вызов инструмента",
      () => ({ type: "tool_calls", calls: [{ id: "1", name: "x", arguments: {} }] }),
      "вызов инструмента",
    ],
    ["нет строк с периодом и числом", () => ({ type: "text", content: "Просто текст." }), "нет строки с периодом"],
    [
      "неверный период",
      (request) => ({
        type: "text",
        content: (goodReply(request) as { content: string }).content.replace(
          "2026-09-23T10:01:00Z",
          "2026-09-22T10:01:00Z",
        ),
      }),
      "Период в ответе модели не совпадает",
    ],
    [
      "неверное число наблюдений",
      (request) => ({
        type: "text",
        content: (goodReply(request) as { content: string }).content.replace(
          "Уникальных наблюдений: 1",
          "Уникальных наблюдений: 6",
        ),
      }),
      "Число уникальных наблюдений",
    ],
  ];

  it.each(cases)(
    "%s: прежняя сводка сохраняется, причина фиксируется, повторного запроса нет",
    async (_name, reply, reason) => {
      const scheduler = schedulerWithSchedule();
      scheduler.summaries.push("ПРЕЖНЯЯ СВОДКА");
      const model = new FakeModel(reply);
      const { events } = await runScenario({ scheduler, model, endAt: T0 + 60 * SECOND });
      expect(model.requests).toHaveLength(1);
      expect(scheduler.summaries).toEqual(["ПРЕЖНЯЯ СВОДКА"]);
      expect(scheduler.failures).toHaveLength(1);
      expect(scheduler.failures[0]).toContain(reason);
      expect(events.reports).toEqual([]);
      expect(events.failed).toEqual([
        { scheduleId: "sch_00000001", city: "Новосибирск", reason: scheduler.failures[0] },
      ]);
      expect(scheduler.schedules[0]?.nextSummaryAtMs).toBe(T0 + 120 * SECOND);
    },
  );

  it("ошибка модели записывается с кодом и статусом, без тела ответа провайдера", async () => {
    const scheduler = schedulerWithSchedule();
    const model = new FakeModel(() => Promise.reject(new AgentError("MODEL_FAILURE", { status: 401 })));
    await runScenario({ scheduler, model, endAt: T0 + 60 * SECOND });
    expect(scheduler.failures).toEqual(["Ошибка модели: MODEL_FAILURE (HTTP 401)."]);
    const unknown = new FakeModel(() => Promise.reject(new Error("Bearer sk-secret")));
    const other = schedulerWithSchedule();
    await runScenario({ scheduler: other, model: unknown, endAt: T0 + 60 * SECOND });
    expect(other.failures).toEqual(["Запрос к модели завершился ошибкой."]);
  });

  it("допускает разметку вокруг обязательных строк и точку после числа", async () => {
    const scheduler = schedulerWithSchedule();
    const model = new FakeModel((request) => {
      const [period, count] = (goodReply(request) as { content: string }).content.split("\n");
      return { type: "text", content: `**${period}**\n- ${count}.\n\n${MODEL_TEXT}` };
    });
    const { events } = await runScenario({ scheduler, model, endAt: T0 + 60 * SECOND });
    expect(events.reports).toHaveLength(1);
  });
});
