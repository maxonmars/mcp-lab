import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { SchedulerService } from "../service/service.ts";
import { historyRowSchema, pollResultSchema, timestamp } from "./schemas.ts";
import { guarded, reply } from "./toolResult.ts";

export const WORKER_TOOL_NAMES = [
  "worker_start",
  "worker_get_due",
  "worker_record_poll",
  "worker_get_history",
  "worker_publish_summary",
  "worker_record_summary_failure",
] as const;

const internal = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function registerLifecycleTools(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    "worker_start",
    {
      description: "Служебная: занимает единственное право worker на эту базу.",
      inputSchema: z.object({}),
      outputSchema: z.object({ status: z.enum(["started", "already_running"]) }),
      annotations: internal,
    },
    async () =>
      guarded(() => {
        const status = service.startWorker();
        return reply(status === "started" ? "Worker запущен." : "Worker уже запущен для этой базы.", { status });
      }),
  );

  server.registerTool(
    "worker_get_due",
    {
      description: "Служебная: активные расписания с наступившим сроком опроса или сводки и ближайший срок.",
      inputSchema: z.object({ nowMs: timestamp }),
      outputSchema: z.object({
        tasks: z.array(
          z.object({ scheduleId: z.string(), city: z.string(), collectDue: z.boolean(), summaryDue: z.boolean() }),
        ),
        nextDueAtMs: z.number().nullable(),
      }),
      annotations: { ...internal, readOnlyHint: true, idempotentHint: true },
    },
    async ({ nowMs }) =>
      guarded(() => {
        const due = service.dueTasks(nowMs);
        return reply(`Просроченных заданий: ${due.tasks.length}.`, due);
      }),
  );
}

function registerPollTools(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    "worker_record_poll",
    {
      description: "Служебная: записывает результат опроса погоды и назначает следующий срок опроса.",
      inputSchema: z.object({ scheduleId: z.string(), requestedAtMs: timestamp, result: pollResultSchema }),
      outputSchema: z.object({ locationChanged: z.boolean() }),
      annotations: internal,
    },
    async ({ scheduleId, requestedAtMs, result }) =>
      guarded(() => {
        const outcome = service.recordPoll({ scheduleId, requestedAtMs, result });
        return reply("Опрос записан.", outcome);
      }),
  );

  server.registerTool(
    "worker_get_history",
    {
      description: "Служебная: опросы расписания за период, границы включены, в порядке записи.",
      inputSchema: z.object({ scheduleId: z.string(), fromMs: timestamp, toMs: timestamp }),
      outputSchema: z.object({ polls: z.array(historyRowSchema) }),
      annotations: { ...internal, readOnlyHint: true, idempotentHint: true },
    },
    async ({ scheduleId, fromMs, toMs }) =>
      guarded(() => {
        const polls = service.history(scheduleId, fromMs, toMs);
        return reply(`Опросов за период: ${polls.length}.`, { polls });
      }),
  );
}

function registerSummaryTools(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    "worker_publish_summary",
    {
      description: "Служебная: публикует готовый Markdown сводки в SQLite и файле и назначает следующий срок.",
      inputSchema: z.object({
        scheduleId: z.string(),
        startedAtMs: timestamp,
        periodStartMs: timestamp,
        periodEndMs: timestamp,
        uniqueObservations: z.number().int().nonnegative(),
        markdown: z.string().min(1),
      }),
      outputSchema: z.object({ fileSynced: z.boolean() }),
      annotations: internal,
    },
    async (input) =>
      guarded(() => {
        const outcome = service.publishSummary(input);
        return reply(
          outcome.fileSynced ? "Сводка опубликована." : "Сводка сохранена в SQLite; файл не записан.",
          outcome,
        );
      }),
  );

  server.registerTool(
    "worker_record_summary_failure",
    {
      description: "Служебная: фиксирует ошибку публикации, сохраняя прежнюю сводку, и назначает следующий срок.",
      inputSchema: z.object({
        scheduleId: z.string(),
        startedAtMs: timestamp,
        reason: z.string().trim().min(1).max(300),
      }),
      outputSchema: z.object({ recorded: z.boolean() }),
      annotations: internal,
    },
    async (input) =>
      guarded(() => {
        service.recordSummaryFailure(input);
        return reply("Ошибка публикации записана.", { recorded: true });
      }),
  );
}

export function registerWorkerTools(server: McpServer, service: SchedulerService): void {
  registerLifecycleTools(server, service);
  registerPollTools(server, service);
  registerSummaryTools(server, service);
}
