import { describe, expect, it, vi } from "vitest";
import { SchedulerError } from "../errors.ts";
import { type CallResult, type Connect, connectStdio, type McpCaller, type McpEndpoint } from "../mcp.ts";
import { schedulerPort } from "../schedulerPort.ts";
import { schedulerServerArgs } from "../serverArgs.ts";
import { readSchedulerSummary } from "../summaryReader.ts";
import { weatherPort } from "../weatherPort.ts";
import { openWorkerSession } from "../workerSession.ts";
import { observation } from "./support.ts";

const structuredResult = (structuredContent: unknown): CallResult => ({ content: [], structuredContent });

function caller(answer: (name: string, args: Readonly<Record<string, unknown>>) => CallResult | Promise<CallResult>) {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const close = vi.fn(async () => {});
  const value: McpCaller = {
    call: async (name, args) => {
      calls.push({ name, args });
      return answer(name, args);
    },
    close,
  };
  return { value, calls, close };
}

const snapshot = {
  location: { name: "Новосибирск", latitude: 55.03, longitude: 82.92, timezone: "Asia/Novosibirsk" },
  observedAt: "2026-09-24T17:00",
  observedAtUtc: "2026-09-24T10:00:00Z",
  condition: { code: 3, description: "пасмурно" },
  temperature: 12.5,
  apparentTemperature: 10,
  relativeHumidity: 60,
  precipitation: 0,
  windSpeed: 10,
};

describe("weatherPort", () => {
  it("читает structuredContent, а не текст, и возвращает UTC-время наблюдения", async () => {
    const weather = caller(() => ({
      content: [{ type: "text", text: "текст, который не разбирается" }],
      structuredContent: snapshot,
    }));
    const result = await weatherPort(weather.value).observe("Новосибирск");
    expect(weather.calls).toEqual([{ name: "get_current_weather", args: { location: "Новосибирск" } }]);
    expect(result).toEqual({ ok: true, observation: observation({ temperature: 12.5 }) });
  });

  it("isError → безопасный текст сервера, обрезанный по длине", async () => {
    const long = "О".repeat(500);
    const weather = caller(() => ({ isError: true, content: [{ type: "text", text: long }] }));
    const result = await weatherPort(weather.value).observe("Х");
    expect(result).toEqual({ ok: false, error: "О".repeat(200) });
    const empty = caller(() => ({ isError: true, content: [] }));
    expect(await weatherPort(empty.value).observe("Х")).toEqual({
      ok: false,
      error: "MCP-сервер погоды вернул ошибку.",
    });
  });

  it("результат без observedAtUtc считается некорректным, а не заполняется локальным временем", async () => {
    const { observedAtUtc: _omitted, ...withoutUtc } = snapshot;
    const weather = caller(() => structuredResult(withoutUtc));
    expect(await weatherPort(weather.value).observe("Х")).toEqual({
      ok: false,
      error: "MCP-сервер погоды вернул некорректный результат.",
    });
  });

  it("таймаут и сбой вызова становятся ошибкой опроса без текста исключения", async () => {
    const timeout = caller(() => Promise.reject(new SchedulerError("TIMEOUT", "weather")));
    expect(await weatherPort(timeout.value).observe("Х")).toEqual({
      ok: false,
      error: "Истёк таймаут MCP-вызова погоды.",
    });
    const broken = caller(() => Promise.reject(new Error("token=abc")));
    expect(await weatherPort(broken.value).observe("Х")).toEqual({
      ok: false,
      error: "Не удалось выполнить MCP-вызов погоды.",
    });
  });
});

describe("schedulerPort", () => {
  it("передаёт служебные операции с точными аргументами и проверяет результаты", async () => {
    const scheduler = caller((name) => {
      const answers: Record<string, unknown> = {
        worker_start: { status: "started" },
        worker_get_due: {
          tasks: [{ scheduleId: "sch_1", city: "Омск", collectDue: true, summaryDue: false }],
          nextDueAtMs: 5,
        },
        worker_record_poll: { locationChanged: false },
        worker_get_history: {
          polls: [{ requestedAtMs: 1, ok: true, observedAtUtc: "t", temperature: 1, condition: "c" }],
        },
        worker_publish_summary: { fileSynced: true },
        worker_record_summary_failure: { recorded: true },
      };
      return structuredResult(answers[name]);
    });
    const port = schedulerPort(scheduler.value);
    await port.start();
    expect((await port.dueTasks(7)).tasks[0]?.city).toBe("Омск");
    await port.recordPoll({ scheduleId: "sch_1", requestedAtMs: 1, result: { ok: false, error: "e" } });
    expect(await port.history("sch_1", 0, 9)).toHaveLength(1);
    const publish = {
      scheduleId: "sch_1",
      startedAtMs: 1,
      periodStartMs: 0,
      periodEndMs: 1,
      uniqueObservations: 0,
      markdown: "m",
    };
    expect(await port.publishSummary(publish)).toEqual({ fileSynced: true });
    await port.recordSummaryFailure({ scheduleId: "sch_1", startedAtMs: 1, reason: "r" });
    expect(scheduler.calls.map((call) => call.name)).toEqual([
      "worker_start",
      "worker_get_due",
      "worker_record_poll",
      "worker_get_history",
      "worker_publish_summary",
      "worker_record_summary_failure",
    ]);
    expect(scheduler.calls[1]?.args).toEqual({ nowMs: 7 });
    expect(scheduler.calls[3]?.args).toEqual({ scheduleId: "sch_1", fromMs: 0, toMs: 9 });
  });

  it("already_running → WORKER_ALREADY_RUNNING; isError → CALL_FAILED; чужая форма → INVALID_RESULT", async () => {
    const running = caller(() => structuredResult({ status: "already_running" }));
    await expect(schedulerPort(running.value).start()).rejects.toMatchObject({ code: "WORKER_ALREADY_RUNNING" });
    const failed = caller(() => ({ isError: true, content: [{ type: "text", text: "секрет" }] }));
    await expect(schedulerPort(failed.value).dueTasks(1)).rejects.toMatchObject({ code: "CALL_FAILED" });
    const invalid = caller(() => structuredResult({ tasks: "нет" }));
    await expect(schedulerPort(invalid.value).dueTasks(1)).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });
});

describe("openWorkerSession", () => {
  const config = {
    nodeExecutable: "node",
    entrypoint: "/srv/scheduler/main.ts",
    dbPath: "/data/db.sqlite",
    reportsDir: "/data/reports",
    timeoutMs: 123,
    weatherEntrypoint: "/srv/weather/main.ts",
  };

  it("запускает scheduler в режиме worker и оба сервера с --ignore-sigint, закрывает оба", async () => {
    const endpoints: [McpEndpoint, string][] = [];
    const callers = { scheduler: caller(() => structuredResult({})), weather: caller(() => structuredResult({})) };
    const connect: Connect = async (endpoint, server) => {
      endpoints.push([endpoint, server]);
      return callers[server].value;
    };
    const session = await openWorkerSession({ ...config, connect });
    expect(endpoints).toEqual([
      [
        {
          command: "node",
          args: [
            "/srv/scheduler/main.ts",
            "--db",
            "/data/db.sqlite",
            "--reports-dir",
            "/data/reports",
            "--worker",
            "--ignore-sigint",
          ],
          timeoutMs: 123,
        },
        "scheduler",
      ],
      [{ command: "node", args: ["/srv/weather/main.ts", "--ignore-sigint"], timeoutMs: 123 }, "weather"],
    ]);
    await session.close();
    expect(callers.scheduler.close).toHaveBeenCalledOnce();
    expect(callers.weather.close).toHaveBeenCalledOnce();
  });

  it("если погодный сервер не запустился, соединение с планировщиком закрывается", async () => {
    const scheduler = caller(() => structuredResult({}));
    const connect: Connect = async (_endpoint, server) => {
      if (server === "weather") throw new SchedulerError("SERVER_START_FAILED", "weather");
      return scheduler.value;
    };
    await expect(openWorkerSession({ ...config, connect })).rejects.toMatchObject({
      code: "SERVER_START_FAILED",
      server: "weather",
    });
    expect(scheduler.close).toHaveBeenCalledOnce();
  });

  it("сбой закрытия одного соединения не мешает закрыть второе и сообщается CLOSE_FAILED", async () => {
    const scheduler = caller(() => structuredResult({}));
    const weather = caller(() => structuredResult({}));
    weather.close.mockRejectedValueOnce(new Error("boom"));
    const session = await openWorkerSession({
      ...config,
      connect: async (_e, server) => (server === "weather" ? weather.value : scheduler.value),
    });
    await expect(session.close()).rejects.toMatchObject({ code: "CLOSE_FAILED" });
    expect(scheduler.close).toHaveBeenCalledOnce();
  });
});

describe("readSchedulerSummary", () => {
  const config = {
    nodeExecutable: "node",
    entrypoint: "/srv/main.ts",
    dbPath: "/d/db",
    reportsDir: "/d/r",
    timeoutMs: 5,
  };

  it("ID расписания уходит как scheduleId, остальное — как city; соединение публичное и закрывается", async () => {
    const reader = caller(() => structuredResult({ status: "not_found" }));
    const endpoints: McpEndpoint[] = [];
    const connect: Connect = async (endpoint) => {
      endpoints.push(endpoint);
      return reader.value;
    };
    await readSchedulerSummary({ ...config, connect }, "sch_0a1b2c3d");
    await readSchedulerSummary({ ...config, connect }, "Нижний Новгород");
    await readSchedulerSummary({ ...config, connect }, "sch_XYZ");
    expect(reader.calls.map((call) => call.args)).toEqual([
      { scheduleId: "sch_0a1b2c3d" },
      { city: "Нижний Новгород" },
      { city: "sch_XYZ" },
    ]);
    expect(endpoints[0]?.args).toEqual(schedulerServerArgs(config, "public"));
    expect(endpoints[0]?.args).not.toContain("--worker");
    expect(reader.close).toHaveBeenCalledTimes(3);
  });

  it("«не найдено» разбирается со списком существующих расписаний, а без списка — с пустым", async () => {
    const known = {
      scheduleId: "sch_1",
      city: "Новосибирск, Россия",
      collectEverySeconds: 10,
      summaryEverySeconds: 60,
      scheduleStatus: "active",
    };
    const withList = caller(() => structuredResult({ status: "not_found", candidates: [known] }));
    expect(await readSchedulerSummary({ ...config, connect: async () => withList.value }, "Омск")).toEqual({
      status: "not_found",
      candidates: [known],
    });
    const bare = caller(() => structuredResult({ status: "not_found" }));
    expect(await readSchedulerSummary({ ...config, connect: async () => bare.value }, "Омск")).toEqual({
      status: "not_found",
      candidates: [],
    });
  });

  it("разбирает найденную сводку и закрывает соединение даже при ошибке результата", async () => {
    const found = caller(() =>
      structuredResult({
        status: "found",
        scheduleId: "sch_1",
        city: "Омск",
        scheduleStatus: "active",
        publishedAt: "t",
        markdown: "# М",
      }),
    );
    expect(await readSchedulerSummary({ ...config, connect: async () => found.value }, "Омск")).toMatchObject({
      status: "found",
      markdown: "# М",
    });
    const broken = caller(() => structuredResult({ status: "неизвестно" }));
    await expect(readSchedulerSummary({ ...config, connect: async () => broken.value }, "Омск")).rejects.toMatchObject({
      code: "INVALID_RESULT",
    });
    expect(broken.close).toHaveBeenCalledOnce();
  });

  it("сбой закрытия без другой ошибки — CLOSE_FAILED; основная ошибка не подменяется", async () => {
    const closing = caller(() => structuredResult({ status: "not_found" }));
    closing.close.mockRejectedValue(new Error("x"));
    await expect(readSchedulerSummary({ ...config, connect: async () => closing.value }, "Омск")).rejects.toMatchObject(
      { code: "CLOSE_FAILED" },
    );
    const both = caller(() => ({ isError: true, content: [] }));
    both.close.mockRejectedValue(new Error("x"));
    await expect(readSchedulerSummary({ ...config, connect: async () => both.value }, "Омск")).rejects.toMatchObject({
      code: "CALL_FAILED",
    });
  });
});

describe("connectStdio", () => {
  it("несуществующая команда — SERVER_START_FAILED, молчащий сервер — TIMEOUT, ранний выход — CONNECT_FAILED", async () => {
    const node = process.execPath;
    await expect(
      connectStdio({ command: "/nonexistent/node", args: [], timeoutMs: 1000 }, "scheduler"),
    ).rejects.toMatchObject({
      code: "SERVER_START_FAILED",
      server: "scheduler",
    });
    await expect(
      connectStdio({ command: node, args: ["-e", "setTimeout(()=>{},60000)"], timeoutMs: 300 }, "weather"),
    ).rejects.toMatchObject({ code: "TIMEOUT", server: "weather" });
    await expect(
      connectStdio({ command: node, args: ["-e", "process.exit(3)"], timeoutMs: 1000 }, "scheduler"),
    ).rejects.toMatchObject({
      code: "CONNECT_FAILED",
    });
  });
});
