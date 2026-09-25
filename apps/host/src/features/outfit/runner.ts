import type { ToolInvocation, ToolSource } from "../../core/index.ts";
import { OutfitError, type OutfitStep } from "./errors.ts";
import { GET_CURRENT_WEATHER, RECOMMEND_OUTFIT, SAVE_OUTFIT_ADVICE } from "./names.ts";

const MIN_LOCATION_LENGTH = 2;
const MAX_LOCATION_LENGTH = 100;

export type OutfitResult = Readonly<{ location: string; markdown: string }>;

/** Те же границы, что у location в get_current_weather: ошибка видна до запуска MCP-сервера. */
export function requireOutfitLocation(location: string): string {
  const trimmed = location.trim();
  if (trimmed.length < MIN_LOCATION_LENGTH || trimmed.length > MAX_LOCATION_LENGTH) {
    throw new OutfitError("INVALID_LOCATION");
  }
  return trimmed;
}

async function runStep(source: ToolSource, step: OutfitStep, invocation: ToolInvocation): Promise<string> {
  let result: Awaited<ReturnType<ToolSource["callTool"]>>;
  try {
    result = await source.callTool(invocation);
  } catch (error) {
    throw new OutfitError("CALL_FAILED", { step }, { cause: error });
  }
  if (result.isError) throw new OutfitError("STEP_FAILED", { step, reason: result.content.trim() || undefined });
  if (!result.content.trim()) throw new OutfitError("EMPTY_RESULT", { step });
  return result.content;
}

/** Три последовательных вызова одного источника; тексты шагов передаются дальше без изменений. */
export async function runOutfitPipeline(source: ToolSource, location: string): Promise<OutfitResult> {
  const city = requireOutfitLocation(location);
  const weatherText = await runStep(source, "weather", {
    name: GET_CURRENT_WEATHER,
    arguments: { location: city, includeNextHours: true },
  });
  const markdown = await runStep(source, "recommend", { name: RECOMMEND_OUTFIT, arguments: { weatherText } });
  await runStep(source, "save", { name: SAVE_OUTFIT_ADVICE, arguments: { markdown } });
  return { location: city, markdown };
}
