import { describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { connectStdio, openWorkerSession } from "../../features/scheduler/index.ts";
import { run } from "../compose.ts";
import {
  createScheduleFromTerminalB,
  deferred,
  MODEL_TEXT,
  SECOND,
  scripted,
  serverConfig,
  summaryReply,
  TestClock,
  tempRoot,
  terminal,
  terminalA,
  terminalB,
  toolCall,
  useTempRoot,
  weatherCaller,
} from "./schedulerHarness.ts";

useTempRoot();

describe("scheduler: команды CLI и REPL", () => {
  it("scheduler summary без аргумента сообщает о недостающем городе или ID, а не о тексте реплики", async () => {
    const result = await terminalB(["scheduler", "summary"], scripted([]).model, false);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Не указан город или ID расписания.");
    expect(result.err).not.toContain("реплики");
  });

  it("scheduler run без LAB_LLM_API_KEY отказывает до запуска процессов", async () => {
    const opened = vi.fn();
    const io = terminal();
    const code = await run({
      argv: ["scheduler", "run"],
      cwd: tempRoot(),
      env: {},
      nodeExecutable: process.execPath,
      terminal: io.io,
      openWorkerSession: opened,
    });
    expect(code).toBe(1);
    expect(io.err()).toContain("LAB_LLM_API_KEY");
    expect(opened).not.toHaveBeenCalled();
  });

  it("справка показывает обе команды и аргумент summary", async () => {
    const result = await terminalB(["help"], scripted([]).model, false);
    expect(result.out).toContain("scheduler run");
    expect(result.out).toContain("scheduler summary <город|ID>");
    expect(result.out).toContain("--scheduler-db-path");
  });
});

describe("scheduler: терминалы A и B", () => {
  it("ask создаёт расписание, worker печатает сводку без реплики, summary и ask читают её без генерации", async () => {
    const { created, createdAt } = await createScheduleFromTerminalB();
    expect(created.code).toBe(0);
    expect(created.out).toContain("MCP: schedule_weather — выполнено");
    expect(created.out).toContain("Расписание создано.");

    const controller = new AbortController();
    const summaryModel = scripted([]);
    const workerModel = {
      complete: async (request: ModelRequest) => {
        summaryModel.requests.push(request);
        return summaryReply(request);
      },
    };
    const clock = new TestClock(createdAt, createdAt + 60 * SECOND, () => controller.abort());
    const a = await terminalA({ clock, controller, model: workerModel });
    expect(a.code).toBe(0);
    expect(summaryModel.requests).toHaveLength(1);
    expect(a.out).toContain("Планировщик запущен");
    expect(a.out).toContain("── Сводка · Новосибирск, Россия ──");
    expect(a.out).toContain(MODEL_TEXT);
    expect(a.out).toContain("Планировщик остановлен.");
    expect(a.release).toHaveBeenCalledOnce();

    const cli = await terminalB(["scheduler", "summary", "Новосибирск"], scripted([]).model, false);
    expect(cli.code).toBe(0);
    expect(cli.createModel).not.toHaveBeenCalled();
    expect(cli.out).toContain("── Сводка · Новосибирск, Россия ──");
    expect(cli.out).toContain(MODEL_TEXT);
    expect(cli.out).toContain("requests: 6");

    const readAsk = scripted([
      toolCall("get_weather_summary", { city: "Новосибирск" }),
      { type: "text", content: "Вот сводка." },
    ]);
    const asked = await terminalB(["ask", "Что в последней сводке по Новосибирску?"], readAsk.model);
    expect(asked.out).toContain("MCP: get_weather_summary — выполнено");
    const toolMessage = readAsk.requests[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", content: expect.stringContaining(MODEL_TEXT) });
    expect(summaryModel.requests).toHaveLength(1);
  });

  it("второй scheduler run отказывает понятным сообщением, первый продолжает работу", async () => {
    const { createdAt } = await createScheduleFromTerminalB();
    const releaseGate = deferred();
    const controller = new AbortController();
    const io = terminal();
    const first = terminalA({
      clock: new TestClock(createdAt, createdAt + 20 * SECOND, () => controller.abort(), releaseGate.promise),
      controller,
      model: { complete: async (request) => summaryReply(request) },
      io,
    });
    await vi.waitFor(() => expect(io.out()).toContain("Планировщик запущен"), { timeout: 8000 });

    const second = await terminalA({
      clock: new TestClock(createdAt, createdAt + 20 * SECOND, () => {}),
      controller: new AbortController(),
      model: { complete: async (request) => summaryReply(request) },
    });
    expect(second.code).toBe(1);
    expect(second.err).toContain("Планировщик уже запущен для этой базы.");
    expect(second.out).not.toContain("Сводка");
    expect(second.sessions).toHaveLength(1);

    releaseGate.resolve();
    expect((await first).code).toBe(0);
    const againController = new AbortController();
    const again = await terminalA({
      clock: new TestClock(createdAt, createdAt + 5 * SECOND, () => againController.abort()),
      controller: againController,
      model: { complete: async (request) => summaryReply(request) },
    });
    expect(again.code).toBe(0);
  });

  it("Ctrl+C во время опроса: опрос сохранён, соединения закрыты, сигнал освобождён, код 0", async () => {
    const { scheduleId, createdAt } = await createScheduleFromTerminalB();
    const controller = new AbortController();
    const gate = deferred();
    const called = deferred();
    const weather = weatherCaller(gate.promise);
    const slowCall = weather.call.bind(weather);
    weather.call = (name, args) => {
      called.resolve();
      return slowCall(name, args);
    };
    const model = scripted([]);
    const running = terminalA({
      clock: new TestClock(createdAt + 10 * SECOND, createdAt + 3600 * SECOND, () => controller.abort()),
      controller,
      model: model.model,
      weather,
    });
    await called.promise;
    controller.abort();
    gate.resolve();
    const a = await running;

    expect(a.code).toBe(0);
    expect(a.out).toContain("Планировщик остановлен.");
    expect(a.release).toHaveBeenCalledOnce();
    expect(model.requests).toEqual([]);
    const reopened = await openWorkerSession({
      ...serverConfig(),
      weatherEntrypoint: "-",
      connect: (e, s) => (s === "weather" ? Promise.resolve(weatherCaller()) : connectStdio(e, s)),
    });
    await reopened.scheduler.start();
    const history = await reopened.scheduler.history(scheduleId, 0, Date.now() + 3600 * SECOND);
    await reopened.close();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ ok: true, observedAtUtc: "2026-09-24T10:00:00Z" });
  });
});
