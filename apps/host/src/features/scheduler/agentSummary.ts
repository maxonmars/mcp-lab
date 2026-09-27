import { type Agent, AgentError, type ToolSource } from "../../core/index.ts";
import { type Aggregate, aggregate } from "./aggregate.ts";
import { buildContext } from "./context.ts";
import type { Clock, SchedulerPort, WorkerEvents } from "./contracts.ts";
import { checkModelText } from "./modelOutput.ts";
import { describeModelFailure, failSummary, publishSummary, SUMMARY_WINDOW_MS } from "./summarize.ts";

const REPORT_TOOL = "get_weather_report_data";
const REPORT_DEFINITION = {
  name: REPORT_TOOL,
  description: "Сохранённые наблюдения погоды за последние 24 часа и рассчитанные показатели для сводки.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;

type AgentSummaryDeps = Readonly<{
  scheduler: SchedulerPort;
  dailyAgent: Agent;
  clock: Clock;
  events: WorkerEvents;
}>;

type Task = Readonly<{ scheduleId: string; city: string }>;

function reportDataSource(deps: AgentSummaryDeps, task: Task, startedAtMs: number) {
  let result: Aggregate | undefined;
  let historyFailed = false;
  const source: ToolSource = {
    listTools: async () => [REPORT_DEFINITION],
    callTool: async (invocation) => {
      if (invocation.name !== REPORT_TOOL) throw new AgentError("UNKNOWN_TOOL_CALL", { name: invocation.name });
      if (Object.keys(invocation.arguments).length > 0) {
        throw new AgentError("INVALID_TOOL_ARGUMENTS", { name: invocation.name });
      }
      const periodStartMs = startedAtMs - SUMMARY_WINDOW_MS;
      let history: Awaited<ReturnType<SchedulerPort["history"]>>;
      try {
        history = await deps.scheduler.history(task.scheduleId, periodStartMs, startedAtMs);
      } catch (error) {
        historyFailed = true;
        throw error;
      }
      const agg = aggregate(history, periodStartMs, startedAtMs);
      result = agg;
      return { content: buildContext(task.city, agg), isError: false };
    },
  };
  return { source, aggregate: () => result, historyFailed: () => historyFailed };
}

/** В ежедневном сроке Agent сам запрашивает историю через один фасад над MCP-портом планировщика. */
export async function summarizeWithAgent(deps: AgentSummaryDeps, task: Task): Promise<void> {
  const startedAtMs = deps.clock.now();
  const data = reportDataSource(deps, task, startedAtMs);
  let text: string;
  try {
    text = await deps.dailyAgent.respond(`Составь сводку погоды для «${task.city}» за последние 24 часа.`, data.source);
  } catch (error) {
    if (data.historyFailed()) throw error;
    await failSummary(deps, task, startedAtMs, describeModelFailure(error));
    return;
  }
  const agg = data.aggregate();
  if (!agg) {
    await failSummary(deps, task, startedAtMs, `Агент не вызвал инструмент ${REPORT_TOOL}.`);
    return;
  }
  const problem = checkModelText(text, agg);
  if (problem) {
    await failSummary(deps, task, startedAtMs, problem);
    return;
  }
  await publishSummary(deps, task, startedAtMs, agg, text);
}
