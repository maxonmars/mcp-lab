import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CliView, InputError } from "../adapters/cli/index.ts";
import { resolveOpenMeteoEntrypoint } from "../features/mcp/index.ts";
import {
  type Clock,
  type Connect,
  openWorkerSession,
  readSchedulerSummary,
  runWorker,
  type SchedulerServerConfig,
  type SummaryReadResult,
  systemClock,
  type WorkerEvents,
  type WorkerSession,
  type WorkerSessionConfig,
} from "../features/scheduler/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { resolveSchedulerEntrypoint } from "./serverEntrypoints.ts";

type Candidate = Extract<SummaryReadResult, { status: "ambiguous" }>["candidates"][number];

/** Сигнал остановки создаёт main.ts: обработчик SIGINT живёт только там. */
export type Interrupt = () => Readonly<{ signal: AbortSignal; release: () => void }>;

export type SchedulerHandlerOptions = Readonly<{
  cwd: string;
  nodeExecutable: string;
  getConfig: () => ResolvedConfig;
  createModel: CreateModel;
  view: CliView;
  interrupt: Interrupt;
  clock?: Clock | undefined;
  connect?: Connect | undefined;
  openWorkerSession?: ((config: WorkerSessionConfig) => Promise<WorkerSession>) | undefined;
  readSummary?: typeof readSchedulerSummary | undefined;
}>;

function readSummaryPrompt(): string {
  return readFileSync(new URL("../features/scheduler/prompts/weatherSummary.md", import.meta.url), "utf8").trim();
}

function serverConfig(options: SchedulerHandlerOptions): SchedulerServerConfig {
  const { values } = options.getConfig();
  return {
    nodeExecutable: options.nodeExecutable,
    entrypoint: resolveSchedulerEntrypoint(import.meta.url),
    dbPath: resolve(options.cwd, values["scheduler.dbPath"]),
    reportsDir: resolve(options.cwd, values["scheduler.reportsDir"]),
    timeoutMs: values["mcp.timeoutMs"],
  };
}

/** Печать после подтверждённого сохранения: worker вызывает report только после ответа сервера. */
function workerEvents(view: CliView, dbPath: string): WorkerEvents {
  return {
    started: () => view.workerStarted(dbPath),
    report: (report) => {
      view.report(report.city, report.markdown);
      if (!report.fileSynced)
        view.warning("Копия .md не записана; сводка сохранена в SQLite и будет восстановлена при чтении.");
    },
    summaryFailed: ({ city, reason }) =>
      view.warning(`Сводка для «${city}» не опубликована: ${reason} Прежняя сводка сохранена.`),
    stopped: () => view.workerStopped(),
  };
}

function describeCandidates(candidates: readonly Candidate[]): string {
  return candidates
    .map((item) => `${item.scheduleId} («${item.city}», ${item.scheduleStatus === "active" ? "активно" : "отменено"})`)
    .join(", ");
}

function summaryText(result: Exclude<SummaryReadResult, { status: "found" }>): string {
  switch (result.status) {
    case "no_summary": {
      const next = result.nextSummaryAt
        ? ` Ближайшая публикация не раньше ${result.nextSummaryAt}.`
        : " Расписание отменено.";
      return `Для расписания ${result.scheduleId} («${result.city}») сводка ещё не опубликована.${next}`;
    }
    case "ambiguous":
      return `Найдено несколько расписаний: ${describeCandidates(result.candidates)}. Укажите ID.`;
    case "not_found": {
      if (result.candidates.length === 0) return "Расписание не найдено: расписаний ещё нет.";
      return `Расписание не найдено. Существующие: ${describeCandidates(result.candidates)}. Укажите ID или название как в расписании.`;
    }
  }
}

export function createSchedulerHandlers(options: SchedulerHandlerOptions) {
  const open = options.openWorkerSession ?? openWorkerSession;
  const read = options.readSummary ?? readSchedulerSummary;

  async function run(): Promise<void> {
    const config = serverConfig(options);
    const model = createConfiguredModel(options.getConfig(), options.createModel);
    const stop = options.interrupt();
    let session: WorkerSession | undefined;
    let failure: unknown;
    try {
      session = await open({
        ...config,
        weatherEntrypoint: resolveOpenMeteoEntrypoint(import.meta.url),
        connect: options.connect,
      });
      await runWorker(
        {
          scheduler: session.scheduler,
          weather: session.weather,
          model,
          clock: options.clock ?? systemClock,
          events: workerEvents(options.view, config.dbPath),
          systemPrompt: readSummaryPrompt(),
        },
        stop.signal,
      );
    } catch (error) {
      failure = error;
    }
    try {
      await session?.close();
    } catch (error) {
      failure ??= error;
    }
    stop.release();
    if (failure) throw failure;
  }

  async function summary(target: string): Promise<{ city: string; markdown: string }> {
    const result = await read({ ...serverConfig(options), connect: options.connect }, target);
    if (result.status !== "found") throw new InputError(summaryText(result));
    return { city: result.city, markdown: result.markdown };
  }

  return { run, summary };
}
