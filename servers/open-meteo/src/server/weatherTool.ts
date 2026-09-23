import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeWeatherError } from "../weather/errors.ts";
import { getCurrentWeather } from "../weather/getCurrentWeather.ts";
import { formatWeatherText, weatherSnapshotSchema } from "../weather/snapshot.ts";
import type { WeatherDependencies } from "../weather/types.ts";

export const GET_CURRENT_WEATHER_TOOL_NAME = "get_current_weather";

const TOOL_DESCRIPTION =
  "Получает текущую погоду по названию города. Вход — город с необязательным уточнением страны " +
  "или региона, например «Новосибирск, Россия». Используй этот инструмент для актуальных " +
  "погодных данных вместо предположений.";

const inputSchema = z.object({
  location: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .describe("Город и необязательная страна или регион, например «Новосибирск, Россия»."),
});

export function registerWeatherTool(server: McpServer, deps: WeatherDependencies): void {
  server.registerTool(
    GET_CURRENT_WEATHER_TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema: weatherSnapshotSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ location }) => {
      try {
        const snapshot = await getCurrentWeather(location, deps);
        return { content: [{ type: "text" as const, text: formatWeatherText(snapshot) }], structuredContent: snapshot };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: describeWeatherError(error) }] };
      }
    },
  );
}
