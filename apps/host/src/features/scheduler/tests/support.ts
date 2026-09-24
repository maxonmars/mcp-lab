import type { ModelCompletion, ModelPort, ModelRequest } from "../../../core/index.ts";
import type {
  Clock,
  DueTasks,
  Observation,
  PollRecord,
  PollResult,
  PublishedReport,
  PublishInput,
  SchedulerPort,
  WeatherPort,
  WorkerEvents,
} from "../contracts.ts";
import { SchedulerError } from "../errors.ts";
import { runWorker } from "../worker.ts";

export const T0 = Date.parse("2026-09-24T10:00:00Z");
export const SECOND = 1000;
export const MODEL_TEXT = "ТЕСТОВЫЙ-ТЕКСТ-МОДЕЛИ-7431: температура держалась ровно.";

/** sleep не ждёт, а сдвигает время; за endAt останавливает worker, как это делает Ctrl+C. */
export class FakeClock implements Clock {
  time: number;
  readonly sleeps: number[] = [];
  readonly #endAt: number;
  readonly #stop: () => void;

  constructor(start: number, endAt: number, stop: () => void) {
    this.time = start;
    this.#endAt = endAt;
    this.#stop = stop;
  }

  now(): number {
    return this.time;
  }

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    if (signal.aborted) return;
    if (this.time + ms > this.#endAt) return this.#stop();
    this.time += ms;
  }
}

type FakeSchedule = {
  id: string;
  city: string;
  collectEverySeconds: number;
  summaryEverySeconds: number;
  nextCollectAtMs: number;
  nextSummaryAtMs: number;
};

/** Как на сервере: своевременный запуск сохраняет сетку, опоздание больше секунды — отсчёт от запуска. */
const nextDeadline = (dueMs: number, intervalSeconds: number, atMs: number) =>
  atMs - dueMs <= SECOND ? dueMs + intervalSeconds * SECOND : atMs + intervalSeconds * SECOND;

/** Порт планировщика в памяти с теми же правилами сроков и границ, что у MCP-сервера. */
export class FakeScheduler implements SchedulerPort {
  readonly schedules: FakeSchedule[] = [];
  readonly polls: (PollRecord & { scheduleId: string })[] = [];
  readonly summaries: string[] = [];
  readonly failures: string[] = [];
  readonly log: string[] = [];
  alreadyRunning = false;
  dueError: Error | undefined;

  addSchedule(createdAtMs: number, collectEverySeconds = 10, summaryEverySeconds = 60, city = "Новосибирск"): string {
    const id = `sch_${String(this.schedules.length + 1).padStart(8, "0")}`;
    this.schedules.push({
      id,
      city,
      collectEverySeconds,
      summaryEverySeconds,
      nextCollectAtMs: createdAtMs + collectEverySeconds * SECOND,
      nextSummaryAtMs: createdAtMs + summaryEverySeconds * SECOND,
    });
    return id;
  }

  async start(): Promise<void> {
    if (this.alreadyRunning) throw new SchedulerError("WORKER_ALREADY_RUNNING", "scheduler");
    this.log.push("start");
  }

  async dueTasks(nowMs: number): Promise<DueTasks> {
    if (this.dueError) throw this.dueError;
    const tasks = this.schedules
      .map((s) => ({
        scheduleId: s.id,
        city: s.city,
        collectDue: s.nextCollectAtMs <= nowMs,
        summaryDue: s.nextSummaryAtMs <= nowMs,
      }))
      .filter((task) => task.collectDue || task.summaryDue);
    const deadlines = this.schedules.flatMap((s) => [s.nextCollectAtMs, s.nextSummaryAtMs]);
    return { tasks, nextDueAtMs: deadlines.length > 0 ? Math.min(...deadlines) : null };
  }

  async recordPoll(input: { scheduleId: string; requestedAtMs: number; result: PollResult }) {
    this.log.push("poll");
    const schedule = this.#schedule(input.scheduleId);
    const { result } = input;
    this.polls.push({
      scheduleId: input.scheduleId,
      requestedAtMs: input.requestedAtMs,
      ok: result.ok,
      ...(result.ok
        ? {
            observedAtUtc: result.observation.observedAtUtc,
            temperature: result.observation.temperature,
            condition: result.observation.condition,
          }
        : { error: result.error }),
    });
    schedule.nextCollectAtMs = nextDeadline(
      schedule.nextCollectAtMs,
      schedule.collectEverySeconds,
      input.requestedAtMs,
    );
    return { locationChanged: false };
  }

  async history(scheduleId: string, fromMs: number, toMs: number): Promise<readonly PollRecord[]> {
    this.log.push("history");
    return this.polls.filter(
      (p) => p.scheduleId === scheduleId && p.requestedAtMs >= fromMs && p.requestedAtMs <= toMs,
    );
  }

  async publishSummary(input: PublishInput): Promise<{ fileSynced: boolean }> {
    this.log.push("publish");
    const schedule = this.#schedule(input.scheduleId);
    this.summaries.push(input.markdown);
    schedule.nextSummaryAtMs = nextDeadline(schedule.nextSummaryAtMs, schedule.summaryEverySeconds, input.startedAtMs);
    return { fileSynced: true };
  }

  async recordSummaryFailure(input: { scheduleId: string; startedAtMs: number; reason: string }): Promise<void> {
    this.log.push("failure");
    const schedule = this.#schedule(input.scheduleId);
    this.failures.push(input.reason);
    schedule.nextSummaryAtMs = nextDeadline(schedule.nextSummaryAtMs, schedule.summaryEverySeconds, input.startedAtMs);
  }

  #schedule(id: string): FakeSchedule {
    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) throw new Error(`нет расписания ${id}`);
    return schedule;
  }
}

export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observedAtUtc: "2026-09-24T10:00:00Z",
    observedAtLocal: "2026-09-24T17:00",
    locationName: "Новосибирск",
    latitude: 55.03,
    longitude: 82.92,
    temperature: 12,
    apparentTemperature: 10,
    relativeHumidity: 60,
    precipitation: 0,
    windSpeed: 10,
    condition: "пасмурно",
    ...overrides,
  };
}

export class FakeWeather implements WeatherPort {
  readonly cities: string[] = [];
  readonly #answer: (call: number) => PollResult | Promise<PollResult>;

  constructor(
    answer: (call: number) => PollResult | Promise<PollResult> = () => ({ ok: true, observation: observation() }),
  ) {
    this.#answer = answer;
  }

  async observe(city: string): Promise<PollResult> {
    this.cities.push(city);
    return this.#answer(this.cities.length);
  }
}

/** Две строки из раздела «Обязательные строки» запроса: их модель должна вернуть дословно. */
export function requiredLines(request: ModelRequest): string {
  const last = request.messages.at(-1);
  const content = last && "content" in last ? (last.content ?? "") : "";
  return content
    .split("\n")
    .filter((line) => line.startsWith("    "))
    .map((line) => line.trim())
    .join("\n");
}

export const userMessage = (request: ModelRequest): string => {
  const last = request.messages.at(-1);
  return last && "content" in last ? (last.content ?? "") : "";
};

export const goodReply = (request: ModelRequest): ModelCompletion => ({
  type: "text",
  content: `${requiredLines(request)}\n\n${MODEL_TEXT}`,
});

export class FakeModel implements ModelPort {
  readonly requests: ModelRequest[] = [];
  readonly #reply: (request: ModelRequest) => ModelCompletion | Promise<ModelCompletion>;

  constructor(reply: (request: ModelRequest) => ModelCompletion | Promise<ModelCompletion> = goodReply) {
    this.#reply = reply;
  }

  async complete(request: ModelRequest): Promise<ModelCompletion> {
    this.requests.push(request);
    return this.#reply(request);
  }
}

export function recordingEvents(log: string[]): WorkerEvents & {
  reports: PublishedReport[];
  failed: { scheduleId: string; city: string; reason: string }[];
} {
  const reports: PublishedReport[] = [];
  const failed: { scheduleId: string; city: string; reason: string }[] = [];
  return {
    reports,
    failed,
    started: () => log.push("started"),
    report: (report) => {
      log.push("report");
      reports.push(report);
    },
    summaryFailed: (failure) => {
      log.push("summaryFailed");
      failed.push(failure);
    },
    stopped: () => log.push("stopped"),
  };
}

export type ScenarioOptions = Readonly<{
  scheduler?: FakeScheduler;
  weather?: FakeWeather;
  model?: FakeModel;
  startAt?: number;
  endAt: number;
}>;

/** Запускает worker на управляемых часах до endAt; операции в тесте выполняются мгновенно. */
export async function runScenario(options: ScenarioOptions) {
  const scheduler = options.scheduler ?? new FakeScheduler();
  const weather = options.weather ?? new FakeWeather();
  const model = options.model ?? new FakeModel();
  const controller = new AbortController();
  const clock = new FakeClock(options.startAt ?? T0, options.endAt, () => controller.abort());
  const events = recordingEvents(scheduler.log);
  await runWorker({ scheduler, weather, model, clock, events, systemPrompt: "SYSTEM-PROMPT" }, controller.signal);
  return { scheduler, weather, model, clock, events };
}
