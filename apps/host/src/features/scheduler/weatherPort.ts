import { z } from "zod";
import type { PollResult, WeatherPort } from "./contracts.ts";
import { SchedulerError } from "./errors.ts";
import type { McpCaller } from "./mcp.ts";

export const GET_CURRENT_WEATHER = "get_current_weather";
const MAX_ERROR_TEXT_LENGTH = 200;

const snapshotSchema = z.object({
  location: z.object({ name: z.string(), latitude: z.number(), longitude: z.number() }),
  observedAt: z.string(),
  observedAtUtc: z.string().min(1),
  condition: z.object({ description: z.string() }),
  temperature: z.number(),
  apparentTemperature: z.number(),
  relativeHumidity: z.number(),
  precipitation: z.number(),
  windSpeed: z.number(),
});

function failure(error: string): PollResult {
  return { ok: false, error };
}

function errorText(content: readonly unknown[]): string {
  const texts = content.flatMap((block) =>
    typeof block === "object" && block !== null && "text" in block && typeof block.text === "string"
      ? [block.text]
      : [],
  );
  const text = texts.join(" ").trim().slice(0, MAX_ERROR_TEXT_LENGTH);
  return text || "MCP-сервер погоды вернул ошибку.";
}

/** Читает structuredContent get_current_weather напрямую: ToolSource core оставляет только текст. */
export function weatherPort(caller: McpCaller): WeatherPort {
  return {
    observe: async (city) => {
      let result: Awaited<ReturnType<McpCaller["call"]>>;
      try {
        result = await caller.call(GET_CURRENT_WEATHER, { location: city });
      } catch (error) {
        const timedOut = error instanceof SchedulerError && error.code === "TIMEOUT";
        return failure(timedOut ? "Истёк таймаут MCP-вызова погоды." : "Не удалось выполнить MCP-вызов погоды.");
      }
      if (result.isError) return failure(errorText(result.content));
      const parsed = snapshotSchema.safeParse(result.structuredContent);
      if (!parsed.success) return failure("MCP-сервер погоды вернул некорректный результат.");
      const snapshot = parsed.data;
      return {
        ok: true,
        observation: {
          observedAtUtc: snapshot.observedAtUtc,
          observedAtLocal: snapshot.observedAt,
          locationName: snapshot.location.name,
          latitude: snapshot.location.latitude,
          longitude: snapshot.location.longitude,
          temperature: snapshot.temperature,
          apparentTemperature: snapshot.apparentTemperature,
          relativeHumidity: snapshot.relativeHumidity,
          precipitation: snapshot.precipitation,
          windSpeed: snapshot.windSpeed,
          condition: snapshot.condition.description,
        },
      };
    },
  };
}
