import { z } from "zod";
import type { DueTasks, PollRecord, SchedulerPort } from "./contracts.ts";
import { SchedulerError } from "./errors.ts";
import type { CallResult, McpCaller } from "./mcp.ts";

const dueSchema = z.object({
  tasks: z.array(
    z.object({ scheduleId: z.string(), city: z.string(), collectDue: z.boolean(), summaryDue: z.boolean() }),
  ),
  nextDueAtMs: z.number().nullable(),
});
const historySchema = z.object({
  polls: z.array(
    z.object({
      requestedAtMs: z.number(),
      ok: z.boolean(),
      error: z.string().optional(),
      observedAtUtc: z.string().optional(),
      temperature: z.number().optional(),
      condition: z.string().optional(),
    }),
  ),
});

/** Результат служебной операции проверяется по схеме: MCP-сервер — граница доверия, а не часть процесса. */
export function structured<T>(result: CallResult, schema: z.ZodType<T>): T {
  if (result.isError) throw new SchedulerError("CALL_FAILED", "scheduler");
  const parsed = schema.safeParse(result.structuredContent);
  if (!parsed.success) throw new SchedulerError("INVALID_RESULT", "scheduler");
  return parsed.data;
}

export function schedulerPort(caller: McpCaller): SchedulerPort {
  return {
    start: async () => {
      const { status } = structured(
        await caller.call("worker_start", {}),
        z.object({ status: z.enum(["started", "already_running"]) }),
      );
      if (status === "already_running") throw new SchedulerError("WORKER_ALREADY_RUNNING", "scheduler");
    },
    dueTasks: async (nowMs): Promise<DueTasks> => structured(await caller.call("worker_get_due", { nowMs }), dueSchema),
    recordPoll: async (input) =>
      structured(await caller.call("worker_record_poll", input), z.object({ locationChanged: z.boolean() })),
    history: async (scheduleId, fromMs, toMs): Promise<readonly PollRecord[]> =>
      structured(await caller.call("worker_get_history", { scheduleId, fromMs, toMs }), historySchema).polls,
    publishSummary: async (input) =>
      structured(await caller.call("worker_publish_summary", input), z.object({ fileSynced: z.boolean() })),
    recordSummaryFailure: async (input) => {
      structured(await caller.call("worker_record_summary_failure", input), z.object({ recorded: z.boolean() }));
    },
  };
}
