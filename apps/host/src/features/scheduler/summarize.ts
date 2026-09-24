import { AgentError, type Message, type ModelPort } from "../../core/index.ts";
import { type Aggregate, aggregate } from "./aggregate.ts";
import { buildContext } from "./context.ts";
import type { Clock, PublishedReport, SchedulerPort, WorkerEvents } from "./contracts.ts";
import { checkModelText } from "./modelOutput.ts";
import { assembleReport } from "./report.ts";

export const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SummaryDeps = Readonly<{
  scheduler: SchedulerPort;
  model: ModelPort;
  clock: Clock;
  events: WorkerEvents;
  systemPrompt: string;
}>;

type Generated = Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; reason: string }>;

function describeModelFailure(error: unknown): string {
  if (!(error instanceof AgentError)) return "Запрос к модели завершился ошибкой.";
  const status = error.data.status === undefined ? "" : ` (HTTP ${error.data.status})`;
  return `Ошибка модели: ${error.code}${status}.`;
}

/** Один платный запрос без повторов: любой отказ возвращается как причина, а не как исключение. */
async function generate(deps: SummaryDeps, city: string, agg: Aggregate): Promise<Generated> {
  const messages: Message[] = [
    { role: "system", content: deps.systemPrompt },
    { role: "user", content: buildContext(city, agg) },
  ];
  let completion: Awaited<ReturnType<ModelPort["complete"]>>;
  try {
    completion = await deps.model.complete({ messages, tools: [], toolChoice: "none" });
  } catch (error) {
    return { ok: false, reason: describeModelFailure(error) };
  }
  if (completion.type !== "text") return { ok: false, reason: "Модель вернула вызов инструмента вместо текста." };
  const problem = checkModelText(completion.content, agg);
  return problem ? { ok: false, reason: problem } : { ok: true, text: completion.content };
}

/** Публикует сводку расписания; ошибки хранилища идут наружу, отказы модели фиксируются и не заменяют прежнюю сводку. */
export async function summarize(deps: SummaryDeps, task: { scheduleId: string; city: string }): Promise<void> {
  const startedAtMs = deps.clock.now();
  const periodStartMs = startedAtMs - SUMMARY_WINDOW_MS;
  const history = await deps.scheduler.history(task.scheduleId, periodStartMs, startedAtMs);
  const agg = aggregate(history, periodStartMs, startedAtMs);
  const generated = await generate(deps, task.city, agg);
  if (!generated.ok) {
    await deps.scheduler.recordSummaryFailure({ scheduleId: task.scheduleId, startedAtMs, reason: generated.reason });
    deps.events.summaryFailed({ scheduleId: task.scheduleId, city: task.city, reason: generated.reason });
    return;
  }
  const markdown = assembleReport({
    scheduleId: task.scheduleId,
    city: task.city,
    aggregate: agg,
    modelText: generated.text,
    generatedAtMs: deps.clock.now(),
  });
  const { fileSynced } = await deps.scheduler.publishSummary({
    scheduleId: task.scheduleId,
    startedAtMs,
    periodStartMs,
    periodEndMs: startedAtMs,
    uniqueObservations: agg.observations.length,
    markdown,
  });
  const report: PublishedReport = { scheduleId: task.scheduleId, city: task.city, markdown, fileSynced };
  deps.events.report(report);
}
