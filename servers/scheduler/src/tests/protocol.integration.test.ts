import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createSchedulerServer, type SchedulerMode, WORKER_TOOL_NAMES } from "../index.ts";
import { createHarness, type Harness, observation, T0 } from "./harness.ts";

let harness: Harness;
let client: Client | undefined;
let handle: StdioServerHandle | undefined;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
  harness?.cleanup();
});

async function connect(mode: SchedulerMode): Promise<Client> {
  harness ??= createHarness();
  const service = harness.open();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createSchedulerServer({ service, mode }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

async function toolNames(connected: Client): Promise<string[]> {
  return (await connected.listTools()).tools.map((tool) => tool.name).sort();
}

async function schedule(connected: Client, city = "Новосибирск") {
  return connected.callTool({
    name: "schedule_weather",
    arguments: { city, collectEverySeconds: 10, summaryEverySeconds: 60 },
  });
}

describe("публичный режим", () => {
  it("предоставляет только три публичных инструмента и не показывает служебные", async () => {
    harness = createHarness();
    const connected = await connect("public");
    expect(connected.getProtocolEra()).toBe("modern");
    expect(await toolNames(connected)).toEqual(["cancel_weather_schedule", "get_weather_summary", "schedule_weather"]);
    await expect(connected.callTool({ name: "worker_start", arguments: {} })).rejects.toThrow(/not found/);
  });

  it("schedule_weather возвращает ID и сроки первого опроса и сводки", async () => {
    harness = createHarness();
    const result = await schedule(await connect("public"));
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      scheduleId: "sch_00000001",
      city: "Новосибирск",
      collectEverySeconds: 10,
      summaryEverySeconds: 60,
      nextCollectAt: new Date(T0 + 10_000).toISOString(),
      nextSummaryAt: new Date(T0 + 60_000).toISOString(),
    });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("sch_00000001") }]);
  });

  it("отклоняет слишком короткие интервалы схемой инструмента", async () => {
    harness = createHarness();
    const connected = await connect("public");
    const result = await connected.callTool({
      name: "schedule_weather",
      arguments: { city: "Омск", collectEverySeconds: 1, summaryEverySeconds: 60 },
    });
    expect(result.isError).toBe(true);
  });

  it("get_weather_summary: нет сводки, неоднозначный город, отсутствие и неверные параметры", async () => {
    harness = createHarness();
    const connected = await connect("public");
    await schedule(connected);
    const read = (args: Record<string, unknown>) =>
      connected.callTool({ name: "get_weather_summary", arguments: args });
    expect((await read({ city: "Новосибирск" })).structuredContent).toMatchObject({
      status: "no_summary",
      scheduleId: "sch_00000001",
    });
    await schedule(connected);
    const ambiguous = await read({ city: "новосибирск" });
    expect(ambiguous.structuredContent).toMatchObject({
      status: "ambiguous",
      candidates: [{ scheduleId: "sch_00000001" }, { scheduleId: "sch_00000002" }],
    });
    const missing = await read({ scheduleId: "sch_ffffffff" });
    expect(missing.structuredContent).toMatchObject({
      status: "not_found",
      candidates: [{ scheduleId: "sch_00000001", city: "Новосибирск" }, { scheduleId: "sch_00000002" }],
    });
    expect((await read({})).isError).toBe(true);
    expect((await read({ city: "Омск", scheduleId: "sch_00000001" })).isError).toBe(true);
  });

  it("расписание со страной находится по названию без страны; «не найдено» перечисляет существующие расписания", async () => {
    harness = createHarness();
    const connected = await connect("public");
    const read = (args: Record<string, unknown>) =>
      connected.callTool({ name: "get_weather_summary", arguments: args });
    const empty = await read({ city: "Омск" });
    expect(empty.content).toEqual([{ type: "text", text: "Расписание не найдено: расписаний ещё нет." }]);
    expect(empty.structuredContent).toEqual({ status: "not_found", candidates: [] });

    await schedule(connected, "Новосибирск, Россия");
    expect((await read({ city: "Новосибирск" })).structuredContent).toMatchObject({
      status: "no_summary",
      scheduleId: "sch_00000001",
      city: "Новосибирск, Россия",
    });
    const missing = await read({ city: "Омск" });
    expect(missing.isError).not.toBe(true);
    expect(missing.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(
          /Существующие расписания[^\n]*\n- sch_00000001: Новосибирск, Россия, опрос каждые 10 с, сводка каждые 60 с, активно/,
        ),
      },
    ]);
  });

  it("get_weather_summary возвращает сохранённый Markdown без обращения к модели, cancel сохраняет его", async () => {
    harness = createHarness();
    const worker = harness.open();
    worker.startWorker();
    const connected = await connect("public");
    await schedule(connected);
    worker.publishSummary({
      scheduleId: "sch_00000001",
      startedAtMs: T0 + 60_000,
      periodStartMs: T0 - 86_400_000,
      periodEndMs: T0 + 60_000,
      uniqueObservations: 1,
      markdown: "---\ncity: Новосибирск\n---\n\n# Сводка\n\nТекст модели.",
    });
    const found = await connected.callTool({ name: "get_weather_summary", arguments: { city: "Новосибирск" } });
    expect(found.content).toEqual([{ type: "text", text: expect.stringContaining("Текст модели.") }]);
    expect(found.structuredContent).toMatchObject({ status: "found", scheduleStatus: "active" });
    const cancelled = await connected.callTool({
      name: "cancel_weather_schedule",
      arguments: { scheduleId: "sch_00000001" },
    });
    expect(cancelled.structuredContent).toEqual({ status: "cancelled" });
    const after = await connected.callTool({ name: "get_weather_summary", arguments: { scheduleId: "sch_00000001" } });
    expect(after.structuredContent).toMatchObject({ status: "found", scheduleStatus: "cancelled" });
  });
});

describe("режим worker", () => {
  it("предоставляет только служебные операции и не показывает публичные", async () => {
    harness = createHarness();
    const connected = await connect("worker");
    expect(await toolNames(connected)).toEqual([...WORKER_TOOL_NAMES].sort());
    await expect(schedule(connected)).rejects.toThrow(/not found/);
  });

  it("операции недоступны до worker_start; второй worker получает already_running", async () => {
    harness = createHarness();
    const connected = await connect("worker");
    const early = await connected.callTool({ name: "worker_get_due", arguments: { nowMs: T0 } });
    expect(early.isError).toBe(true);
    expect((await connected.callTool({ name: "worker_start", arguments: {} })).structuredContent).toEqual({
      status: "started",
    });
    const second = harness.open();
    expect(second.startWorker()).toBe("already_running");
  });

  it("полный цикл: due → опрос → история → публикация → ошибка публикации", async () => {
    harness = createHarness();
    const connected = await connect("worker");
    harness.open().createSchedule({ city: "Омск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    await connected.callTool({ name: "worker_start", arguments: {} });
    const call = (name: string, args: Record<string, unknown>) => connected.callTool({ name, arguments: args });

    const due = await call("worker_get_due", { nowMs: T0 + 10_000 });
    expect(due.structuredContent).toEqual({
      tasks: [{ scheduleId: "sch_00000001", city: "Омск", collectDue: true, summaryDue: false }],
      nextDueAtMs: T0 + 10_000,
    });
    const recorded = await call("worker_record_poll", {
      scheduleId: "sch_00000001",
      requestedAtMs: T0 + 10_000,
      result: { ok: true, observation: observation() },
    });
    expect(recorded.structuredContent).toEqual({ locationChanged: false });
    const history = await call("worker_get_history", { scheduleId: "sch_00000001", fromMs: T0, toMs: T0 + 60_000 });
    expect(history.structuredContent).toEqual({
      polls: [
        {
          requestedAtMs: T0 + 10_000,
          ok: true,
          observedAtUtc: "2026-09-24T10:00:00Z",
          temperature: 12,
          condition: "пасмурно",
        },
      ],
    });
    const published = await call("worker_publish_summary", {
      scheduleId: "sch_00000001",
      startedAtMs: T0 + 60_000,
      periodStartMs: T0 - 86_400_000,
      periodEndMs: T0 + 60_000,
      uniqueObservations: 1,
      markdown: "# Омск",
    });
    expect(published.structuredContent).toEqual({ fileSynced: true });
    const failed = await call("worker_record_summary_failure", {
      scheduleId: "sch_00000001",
      startedAtMs: T0 + 120_000,
      reason: "Пустой ответ модели.",
    });
    expect(failed.structuredContent).toEqual({ recorded: true });
    const unknown = await call("worker_get_history", { scheduleId: "sch_nope", fromMs: T0, toMs: T0 });
    expect(unknown.structuredContent).toEqual({ polls: [] });
  });
});
