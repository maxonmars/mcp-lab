import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type Connect, connectStdio, type McpCaller } from "../mcp.ts";
import { schedulerServerArgs } from "../serverArgs.ts";
import { readSchedulerSummary } from "../summaryReader.ts";
import { runWorker } from "../worker.ts";
import { openWorkerSession } from "../workerSession.ts";
import { FakeClock, FakeModel, MODEL_TEXT, recordingEvents, SECOND } from "./support.ts";

const ENTRYPOINT = fileURLToPath(new URL("../../../../../../servers/scheduler/src/app/main.ts", import.meta.url));

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

function config() {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-scheduler-feature-"));
  mkdirSync(join(root, "data"));
  return {
    nodeExecutable: process.execPath,
    entrypoint: ENTRYPOINT,
    dbPath: join(root, "data", "scheduler.sqlite"),
    reportsDir: join(root, "reports"),
    timeoutMs: 10_000,
  };
}
type Config = ReturnType<typeof config>;

const weatherCaller: McpCaller = {
  call: async () => ({
    content: [],
    structuredContent: {
      location: { name: "Новосибирск", latitude: 55.03, longitude: 82.92, timezone: "Asia/Novosibirsk" },
      observedAt: "2026-09-24T17:00",
      observedAtUtc: "2026-09-24T10:00:00Z",
      condition: { code: 3, description: "пасмурно" },
      temperature: 12,
      apparentTemperature: 10,
      relativeHumidity: 60,
      precipitation: 0,
      windSpeed: 10,
    },
  }),
  close: async () => {},
};
const connect: Connect = (endpoint, server) =>
  server === "weather" ? Promise.resolve(weatherCaller) : connectStdio(endpoint, server);

async function createSchedule(cfg: Config): Promise<number> {
  const caller = await connectStdio(
    { command: cfg.nodeExecutable, args: schedulerServerArgs(cfg, "public"), timeoutMs: cfg.timeoutMs },
    "scheduler",
  );
  try {
    const result = await caller.call("schedule_weather", {
      city: "Новосибирск",
      collectEverySeconds: 10,
      summaryEverySeconds: 60,
    });
    return Date.parse((result.structuredContent as { nextCollectAt: string }).nextCollectAt) - 10 * SECOND;
  } finally {
    await caller.close();
  }
}

/** Прогоняет worker на управляемых часах с настоящим процессом планировщика. */
async function work(cfg: Config, model: FakeModel, startAt: number, seconds: number) {
  const session = await openWorkerSession({ ...cfg, weatherEntrypoint: "не используется", connect });
  const controller = new AbortController();
  const clock = new FakeClock(startAt, startAt + seconds * SECOND, () => controller.abort());
  const events = recordingEvents([]);
  try {
    await runWorker({ ...session, model, clock, events, systemPrompt: "SYSTEM" }, controller.signal);
  } finally {
    await session.close();
  }
  return events;
}

describe("worker с настоящим MCP-сервером планировщика", () => {
  it("минута 10/60: шесть опросов и один вызов модели, отчёт в SQLite и .md, чтение без модели", async () => {
    const cfg = config();
    const createdAt = await createSchedule(cfg);
    const model = new FakeModel();
    const events = await work(cfg, model, createdAt, 60);

    expect(model.requests).toHaveLength(1);
    expect(events.reports).toHaveLength(1);
    const read = await readSchedulerSummary(cfg, "Новосибирск");
    expect(read).toMatchObject({ status: "found", city: "Новосибирск", scheduleStatus: "active" });
    const markdown = read.status === "found" ? read.markdown : "";
    expect(markdown).toBe(events.reports[0]?.markdown);
    expect(markdown).toContain(MODEL_TEXT);
    expect(markdown).toContain("requests: 6");
    expect(markdown).toContain("uniqueObservations: 1");
    const reportFile = join(cfg.reportsDir, `${events.reports[0]?.scheduleId}.md`);
    expect(readFileSync(reportFile, "utf8")).toBe(markdown);
    expect(model.requests).toHaveLength(1);
  });

  it("после перезапуска расписание и сводка сохраняются; просроченные операции выполняются по одному разу", async () => {
    const cfg = config();
    const createdAt = await createSchedule(cfg);
    await work(cfg, new FakeModel(), createdAt, 60);

    const model = new FakeModel();
    const resumedAt = createdAt + 3600 * SECOND;
    const events = await work(cfg, model, resumedAt, 5);
    expect(model.requests).toHaveLength(1);
    const markdown = events.reports[0]?.markdown ?? "";
    expect(markdown).toContain("requests: 7");
    const read = await readSchedulerSummary(cfg, events.reports[0]?.scheduleId ?? "");
    expect(read).toMatchObject({ status: "found", markdown });
  });

  it("второй worker получает отказ, пока первый держит базу, и может запуститься после его закрытия", async () => {
    const cfg = config();
    const open = () => openWorkerSession({ ...cfg, weatherEntrypoint: "не используется", connect });
    const first = await open();
    await first.scheduler.start();
    const second = await open();
    await expect(second.scheduler.start()).rejects.toMatchObject({ code: "WORKER_ALREADY_RUNNING" });
    await second.close();
    await first.close();
    const third = await open();
    await expect(third.scheduler.start()).resolves.toBeUndefined();
    await third.close();
  });

  it("после очистки базы .md остаётся на диске, но сводкой не выдаётся", async () => {
    const cfg = config();
    const createdAt = await createSchedule(cfg);
    const events = await work(cfg, new FakeModel(), createdAt, 60);
    const reportFile = join(cfg.reportsDir, `${events.reports[0]?.scheduleId}.md`);
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${cfg.dbPath}${suffix}`, { force: true });
    expect(existsSync(reportFile)).toBe(true);
    expect(await readSchedulerSummary(cfg, "Новосибирск")).toEqual({ status: "not_found", candidates: [] });
    expect(await readSchedulerSummary(cfg, events.reports[0]?.scheduleId ?? "")).toEqual({
      status: "not_found",
      candidates: [],
    });
  });
});
