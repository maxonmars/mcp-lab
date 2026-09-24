import type { ModelPort } from "../../core/index.ts";
import type { Clock, DueTask, SchedulerPort, WeatherPort, WorkerEvents } from "./contracts.ts";
import { summarize } from "./summarize.ts";

/** Как часто worker проверяет, не создал ли терминал B новое расписание, когда сроков нет. */
export const MAX_IDLE_WAIT_MS = 1_000;
const POLL_FAILURE_REASON = "Опрос погоды завершился непредвиденной ошибкой.";

export type WorkerDeps = Readonly<{
  scheduler: SchedulerPort;
  weather: WeatherPort;
  model: ModelPort;
  clock: Clock;
  events: WorkerEvents;
  systemPrompt: string;
}>;

async function collect(deps: WorkerDeps, task: DueTask): Promise<void> {
  const requestedAtMs = deps.clock.now();
  const result = await deps.weather
    .observe(task.city)
    .catch(() => ({ ok: false as const, error: POLL_FAILURE_REASON }));
  await deps.scheduler.recordPoll({ scheduleId: task.scheduleId, requestedAtMs, result });
}

async function runDue(deps: WorkerDeps, tasks: readonly DueTask[], signal: AbortSignal): Promise<void> {
  for (const task of tasks) {
    if (signal.aborted) return;
    if (task.collectDue) await collect(deps, task);
    if (signal.aborted) return;
    if (task.summaryDue) await summarize(deps, task);
  }
}

/** Последовательный цикл: опрос, затем сводка. Прерывание не запускает новых операций, начатая доводится до сохранения. */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  await deps.scheduler.start();
  deps.events.started();
  try {
    while (!signal.aborted) {
      const { tasks, nextDueAtMs } = await deps.scheduler.dueTasks(deps.clock.now());
      if (tasks.length > 0) {
        await runDue(deps, tasks, signal);
        continue;
      }
      const untilDue = nextDueAtMs === null ? MAX_IDLE_WAIT_MS : nextDueAtMs - deps.clock.now();
      await deps.clock.sleep(Math.min(Math.max(untilDue, 0), MAX_IDLE_WAIT_MS), signal);
    }
  } finally {
    deps.events.stopped();
  }
}
