import { z } from "zod";
import { SchedulerError } from "./errors.ts";
import { type Connect, connectStdio } from "./mcp.ts";
import { structured } from "./schedulerPort.ts";
import { type SchedulerServerConfig, schedulerServerArgs } from "./serverArgs.ts";

/** Формат ID из servers/scheduler; всё остальное читается как название города. */
const SCHEDULE_ID = /^sch_[0-9a-f]{8}$/;

const scheduleStatus = z.enum(["active", "cancelled"]);
const candidate = z.object({
  scheduleId: z.string(),
  city: z.string(),
  collectEverySeconds: z.number(),
  summaryEverySeconds: z.number(),
  scheduleStatus,
  lastPublishedAt: z.string().optional(),
});
const readSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    scheduleId: z.string(),
    city: z.string(),
    scheduleStatus,
    publishedAt: z.string(),
    markdown: z.string(),
  }),
  z.object({
    status: z.literal("no_summary"),
    scheduleId: z.string(),
    city: z.string(),
    scheduleStatus,
    nextSummaryAt: z.string().optional(),
  }),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(candidate) }),
  /** candidates — существующие расписания: подсказка, когда название не совпало ни с одним. */
  z.object({ status: z.literal("not_found"), candidates: z.array(candidate).default([]) }),
]);

export type SummaryReadResult = z.infer<typeof readSchema>;

/** Читает сохранённый текст через публичный get_weather_summary: модель и worker не участвуют. */
export async function readSchedulerSummary(
  config: SchedulerServerConfig & Readonly<{ connect?: Connect | undefined }>,
  target: string,
): Promise<SummaryReadResult> {
  const connect = config.connect ?? connectStdio;
  const caller = await connect(
    { command: config.nodeExecutable, args: schedulerServerArgs(config, "public"), timeoutMs: config.timeoutMs },
    "scheduler",
  );
  let result: SummaryReadResult | undefined;
  let failure: unknown;
  try {
    const args = SCHEDULE_ID.test(target) ? { scheduleId: target } : { city: target };
    result = structured(await caller.call("get_weather_summary", args), readSchema);
  } catch (error) {
    failure = error;
  }
  try {
    await caller.close();
  } catch {
    failure ??= new SchedulerError("CLOSE_FAILED", "scheduler");
  }
  if (failure) throw failure;
  return result as SummaryReadResult;
}
