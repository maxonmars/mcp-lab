import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { COLLECT_INTERVAL_LIMITS_SECONDS, SUMMARY_INTERVAL_LIMITS_SECONDS } from "../service/deadlines.ts";
import type { SchedulerService } from "../service/service.ts";
import { summaryReply } from "./summaryReply.ts";
import { failure, guarded, isoTime, reply } from "./toolResult.ts";

export const SCHEDULE_WEATHER_TOOL_NAME = "schedule_weather";
export const GET_WEATHER_SUMMARY_TOOL_NAME = "get_weather_summary";
export const CANCEL_WEATHER_SCHEDULE_TOOL_NAME = "cancel_weather_schedule";

const scheduleInput = z.object({
  city: z.string().trim().min(2).max(100).describe("Город и необязательная страна, например «Новосибирск»."),
  collectEverySeconds: z
    .number()
    .int()
    .min(COLLECT_INTERVAL_LIMITS_SECONDS.min)
    .max(COLLECT_INTERVAL_LIMITS_SECONDS.max)
    .describe("Как часто опрашивать погоду, секунды."),
  summaryEverySeconds: z
    .number()
    .int()
    .min(SUMMARY_INTERVAL_LIMITS_SECONDS.min)
    .max(SUMMARY_INTERVAL_LIMITS_SECONDS.max)
    .describe("Как часто публиковать сводку за последние 24 часа, секунды."),
});
const scheduleOutput = z.object({
  scheduleId: z.string(),
  city: z.string(),
  collectEverySeconds: z.number(),
  summaryEverySeconds: z.number(),
  nextCollectAt: z.string(),
  nextSummaryAt: z.string(),
});

const summaryInput = z.object({
  scheduleId: z.string().trim().min(1).optional().describe("ID расписания из schedule_weather."),
  city: z.string().trim().min(1).optional().describe("Город, для которого создано расписание."),
});
const scheduleStatus = z.enum(["active", "cancelled"]);
const summaryOutput = z.object({
  status: z.enum(["found", "no_summary", "ambiguous", "not_found"]),
  scheduleId: z.string().optional(),
  city: z.string().optional(),
  scheduleStatus: scheduleStatus.optional(),
  publishedAt: z.string().optional(),
  markdown: z.string().optional(),
  nextSummaryAt: z.string().optional(),
  candidates: z
    .array(
      z.object({
        scheduleId: z.string(),
        city: z.string(),
        collectEverySeconds: z.number(),
        summaryEverySeconds: z.number(),
        scheduleStatus,
        lastPublishedAt: z.string().optional(),
      }),
    )
    .optional(),
});

const cancelInput = z.object({ scheduleId: z.string().trim().min(1).describe("ID расписания.") });
const cancelOutput = z.object({ status: z.enum(["cancelled", "already_cancelled", "not_found"]) });

function registerScheduleTool(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    SCHEDULE_WEATHER_TOOL_NAME,
    {
      description:
        "Создаёт расписание погоды: периодически опрашивает текущую погоду города и периодически публикует " +
        "сводку за последние 24 часа. Используй, когда пользователь просит регулярно проверять погоду и " +
        "выводить сводку. Вход — город и два интервала в секундах: collectEverySeconds и summaryEverySeconds.",
      inputSchema: scheduleInput,
      outputSchema: scheduleOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) =>
      guarded(() => {
        const row = service.createSchedule(input);
        const data = {
          scheduleId: row.id,
          city: row.city,
          collectEverySeconds: row.collectEverySeconds,
          summaryEverySeconds: row.summaryEverySeconds,
          nextCollectAt: isoTime(row.nextCollectAtMs),
          nextSummaryAt: isoTime(row.nextSummaryAtMs),
        };
        const text = [
          `Расписание создано: ${row.id}`,
          `- Город: ${row.city}`,
          `- Опрос: каждые ${row.collectEverySeconds} с, первый — ${data.nextCollectAt}`,
          `- Сводка: каждые ${row.summaryEverySeconds} с, первая — ${data.nextSummaryAt}`,
          "Опросы и сводки выполняются, пока в терминале запущена команда `scheduler run`.",
        ].join("\n");
        return reply(text, data);
      }),
  );
}

function registerSummaryTool(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    GET_WEATHER_SUMMARY_TOOL_NAME,
    {
      description:
        "Возвращает последнюю уже опубликованную сводку погоды по scheduleId или по городу. Не создаёт новую " +
        "сводку и не запрашивает погоду; за текущей погодой обращайся к get_current_weather. Укажи ровно один " +
        "параметр: scheduleId или city (название можно без страны). Если расписание не найдено или их несколько, " +
        "в ответе перечислены существующие расписания с ID.",
      inputSchema: summaryInput,
      outputSchema: summaryOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ scheduleId, city }) =>
      guarded(() => {
        if (Boolean(scheduleId) === Boolean(city)) return failure("Укажите ровно один параметр: scheduleId или city.");
        return summaryReply(service.findSummary({ scheduleId, city }));
      }),
  );
}

function registerCancelTool(server: McpServer, service: SchedulerService): void {
  server.registerTool(
    CANCEL_WEATHER_SCHEDULE_TOOL_NAME,
    {
      description:
        "Отменяет расписание по scheduleId: новые опросы и сводки не запускаются, накопленные данные и " +
        "последняя опубликованная сводка сохраняются.",
      inputSchema: cancelInput,
      outputSchema: cancelOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ scheduleId }) =>
      guarded(() => {
        const { status } = service.cancel(scheduleId);
        const texts = {
          cancelled: `Расписание ${scheduleId} отменено. История и последняя сводка сохранены.`,
          already_cancelled: `Расписание ${scheduleId} уже было отменено.`,
          not_found: "Расписание не найдено.",
        };
        return reply(texts[status], { status });
      }),
  );
}

export function registerPublicTools(server: McpServer, service: SchedulerService): void {
  registerScheduleTool(server, service);
  registerSummaryTool(server, service);
  registerCancelTool(server, service);
}
