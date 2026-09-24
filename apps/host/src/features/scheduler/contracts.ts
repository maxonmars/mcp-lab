export type Clock = Readonly<{
  now(): number;
  /** Ждёт ms миллисекунд; при abort возвращается раньше. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}>;

export type DueTask = Readonly<{ scheduleId: string; city: string; collectDue: boolean; summaryDue: boolean }>;
export type DueTasks = Readonly<{ tasks: readonly DueTask[]; nextDueAtMs: number | null }>;

export type Observation = Readonly<{
  observedAtUtc: string;
  observedAtLocal: string;
  locationName: string;
  latitude: number;
  longitude: number;
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  windSpeed: number;
  condition: string;
}>;

export type PollResult = Readonly<{ ok: true; observation: Observation }> | Readonly<{ ok: false; error: string }>;

/** Запись об опросе в порядке сохранения; ok=false — ошибка или отклонённая точка геокодирования. */
export type PollRecord = Readonly<{
  requestedAtMs: number;
  ok: boolean;
  error?: string;
  observedAtUtc?: string;
  temperature?: number;
  condition?: string;
}>;

export type PublishInput = Readonly<{
  scheduleId: string;
  startedAtMs: number;
  periodStartMs: number;
  periodEndMs: number;
  uniqueObservations: number;
  markdown: string;
}>;

/** Состояние планировщика живёт на стороне MCP-сервера; хост обращается к нему только через этот порт. */
export interface SchedulerPort {
  /** Занимает единственное право worker; WORKER_ALREADY_RUNNING, если база уже обслуживается. */
  start(): Promise<void>;
  dueTasks(nowMs: number): Promise<DueTasks>;
  recordPoll(input: {
    scheduleId: string;
    requestedAtMs: number;
    result: PollResult;
  }): Promise<{ locationChanged: boolean }>;
  /** Опросы за период, обе границы включены. */
  history(scheduleId: string, fromMs: number, toMs: number): Promise<readonly PollRecord[]>;
  publishSummary(input: PublishInput): Promise<{ fileSynced: boolean }>;
  recordSummaryFailure(input: { scheduleId: string; startedAtMs: number; reason: string }): Promise<void>;
}

/** Погода города с сохранением структурированного результата; ошибка опроса — значение, а не исключение. */
export interface WeatherPort {
  observe(city: string): Promise<PollResult>;
}

export type PublishedReport = Readonly<{ scheduleId: string; city: string; markdown: string; fileSynced: boolean }>;

/** События worker для вывода; текст интерфейса формирует получатель. */
export interface WorkerEvents {
  started(): void;
  report(report: PublishedReport): void;
  summaryFailed(failure: { scheduleId: string; city: string; reason: string }): void;
  stopped(): void;
}
