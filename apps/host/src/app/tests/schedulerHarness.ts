import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import {
  type Clock,
  type Connect,
  connectStdio,
  type McpCaller,
  openWorkerSession,
  readSchedulerSummary,
  type SchedulerServerConfig,
  type WorkerSession,
} from "../../features/scheduler/index.ts";
import { run } from "../compose.ts";
import { resolveSchedulerEntrypoint } from "../serverEntrypoints.ts";

export const SECOND = 1000;
export const MODEL_TEXT = "ТЕКСТ-МОДЕЛИ-ДЛЯ-ТЕРМИНАЛА-A-5512";
export const CITY_PROMPT = "Проверяй погоду в Новосибирске каждые 10 секунд, выводи сводку раз в минуту";

let root = "";

export const tempRoot = (): string => root;

/** Временный рабочий каталог на каждый тест: база и отчёты планировщика создаются внутри него. */
export function useTempRoot(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mcp-lab-app-scheduler-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
}

export function terminal() {
  let output = "";
  let error = "";
  const sink = (append: (text: string) => void) =>
    new Writable({
      write(chunk, _encoding, done) {
        append(chunk.toString());
        done();
      },
    });
  return {
    io: {
      input: Readable.from([""]),
      interactive: false,
      output: sink((t) => (output += t)),
      error: sink((t) => (error += t)),
    },
    out: () => output,
    err: () => error,
  };
}

export const weatherCaller = (gate?: Promise<unknown>): McpCaller => ({
  call: async () => {
    await gate;
    return {
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
    };
  },
  close: async () => {},
});

export const summaryReply = (request: ModelRequest): ModelCompletion => {
  const last = request.messages.at(-1);
  const content = last && "content" in last ? (last.content ?? "") : "";
  const lines = content
    .split("\n")
    .filter((line) => line.startsWith("    "))
    .map((line) => line.trim());
  return { type: "text", content: `${lines.join("\n")}\n\n${MODEL_TEXT}` };
};

export function scripted(steps: ModelCompletion[]) {
  const requests: ModelRequest[] = [];
  return {
    requests,
    model: {
      complete: async (request: ModelRequest) => {
        requests.push(request);
        return steps.shift() ?? { type: "text" as const, content: "" };
      },
    },
  };
}

export const toolCall = (name: string, args: Record<string, unknown>): ModelCompletion => ({
  type: "tool_calls",
  calls: [{ id: "call-1", name, arguments: args }],
});

export const emptyWeatherToolSource = {
  listTools: async () => [
    { name: "get_current_weather", description: "погода", inputSchema: { type: "object", properties: {} } },
  ],
  callTool: async () => ({ content: "погода", isError: false }),
};

export function serverConfig(): SchedulerServerConfig {
  return {
    nodeExecutable: process.execPath,
    entrypoint: resolveSchedulerEntrypoint(import.meta.url),
    dbPath: join(root, ".local", "scheduler.sqlite"),
    reportsDir: join(root, ".local", "reports"),
    timeoutMs: 10_000,
  };
}

/** Терминал B: команда CLI в отдельном «процессе» (вызове run) с настоящим публичным MCP-сервером планировщика. */
export async function terminalB(
  argv: string[],
  model: { complete: (r: ModelRequest) => Promise<ModelCompletion> },
  key = true,
) {
  const io = terminal();
  const createModel = vi.fn(() => model);
  const code = await run({
    argv,
    cwd: root,
    env: key ? { LAB_LLM_API_KEY: "test-key" } : {},
    nodeExecutable: process.execPath,
    terminal: io.io,
    createModel,
    withWeatherToolSource: (_options, use) => use(emptyWeatherToolSource),
  });
  return { code, out: io.out(), err: io.err(), createModel };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** sleep сдвигает время; за endAt вызывает stop (Ctrl+C), gate позволяет удержать worker до сигнала теста. */
export class TestClock implements Clock {
  time: number;
  readonly #endAt: number;
  readonly #stop: () => void;
  readonly #gate: Promise<void> | undefined;

  constructor(start: number, endAt: number, stop: () => void, gate?: Promise<void>) {
    this.time = start;
    this.#endAt = endAt;
    this.#stop = stop;
    this.#gate = gate;
  }

  now = () => this.time;

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await this.#gate;
    if (signal.aborted) return;
    if (this.time + ms > this.#endAt) return this.#stop();
    this.time += ms;
  }
}

export type WorkerRunOptions = Readonly<{
  clock: Clock;
  controller: AbortController;
  model: { complete: (r: ModelRequest) => Promise<ModelCompletion> };
  weather?: McpCaller;
  io?: ReturnType<typeof terminal>;
}>;

/** Терминал A: `scheduler run` на управляемых часах; настоящий процесс планировщика, погода подменена. */
export async function terminalA(options: WorkerRunOptions) {
  const io = options.io ?? terminal();
  const release = vi.fn();
  const sessions: WorkerSession[] = [];
  const connect: Connect = (endpoint, server) =>
    server === "weather" ? Promise.resolve(options.weather ?? weatherCaller()) : connectStdio(endpoint, server);
  const code = await run({
    argv: ["scheduler", "run"],
    cwd: root,
    env: { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: process.execPath,
    terminal: io.io,
    createModel: () => options.model,
    clock: options.clock,
    interrupt: () => ({ signal: options.controller.signal, release }),
    openWorkerSession: async (config) => {
      const session = await openWorkerSession({ ...config, connect });
      sessions.push(session);
      return session;
    },
  });
  return { code, out: io.out(), err: io.err(), release, sessions };
}

export async function createScheduleFromTerminalB() {
  const { model } = scripted([
    toolCall("schedule_weather", { city: "Новосибирск, Россия", collectEverySeconds: 10, summaryEverySeconds: 60 }),
    { type: "text", content: "Расписание создано." },
  ]);
  const created = await terminalB(["ask", CITY_PROMPT], model);
  const pending = await readSchedulerSummary(serverConfig(), "Новосибирск");
  if (pending.status !== "no_summary") throw new Error("расписание не создано");
  return { created, scheduleId: pending.scheduleId, createdAt: Date.parse(pending.nextSummaryAt ?? "") - 60 * SECOND };
}
