import { describe, expect, it, vi } from "vitest";
import type { ToolInvocation, ToolResult, ToolSource } from "../../../core/index.ts";
import { describeOutfitError, OutfitError } from "../errors.ts";
import { requireOutfitLocation, runOutfitPipeline } from "../runner.ts";

const WEATHER_TEXT = "Погода в Омске.\nПрогноз на ближайшие часы…\n";
const ADVICE = "# Что надеть сейчас\n\nКуртка.\n";

type Replies = Partial<Record<string, ToolResult | Error>>;

function fakeSource(replies: Replies = {}) {
  const defaults: Record<string, ToolResult> = {
    get_current_weather: { content: WEATHER_TEXT, isError: false },
    recommend_outfit: { content: ADVICE, isError: false },
    save_outfit_advice: { content: "Совет сохранён: /tmp/latest.md", isError: false },
  };
  const callTool = vi.fn(async (invocation: ToolInvocation): Promise<ToolResult> => {
    const reply = replies[invocation.name] ?? defaults[invocation.name];
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error(`неожиданный инструмент ${invocation.name}`);
    return reply;
  });
  const source: ToolSource = { listTools: async () => [], callTool };
  return { source, callTool };
}

describe("runOutfitPipeline", () => {
  it("вызывает три инструмента по порядку и передаёт тексты дословно", async () => {
    const { source, callTool } = fakeSource();
    await expect(runOutfitPipeline(source, "  Омск  ")).resolves.toEqual({ location: "Омск", markdown: ADVICE });
    expect(callTool.mock.calls.map(([invocation]) => invocation)).toEqual([
      { name: "get_current_weather", arguments: { location: "Омск", includeNextHours: true } },
      { name: "recommend_outfit", arguments: { weatherText: WEATHER_TEXT } },
      { name: "save_outfit_advice", arguments: { markdown: ADVICE } },
    ]);
  });

  it.each([
    ["get_current_weather", "weather", 1],
    ["recommend_outfit", "recommend", 2],
    ["save_outfit_advice", "save", 3],
  ])("isError шага %s останавливает цепочку с точной причиной", async (name, step, calls) => {
    const { source, callTool } = fakeSource({ [name]: { content: "Место не найдено.", isError: true } });
    const failure = runOutfitPipeline(source, "Омск");
    await expect(failure).rejects.toMatchObject({ code: "STEP_FAILED", step, reason: "Место не найдено." });
    expect(callTool).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ["get_current_weather", "weather", 1],
    ["recommend_outfit", "recommend", 2],
    ["save_outfit_advice", "save", 3],
  ])("пустой текст шага %s — EMPTY_RESULT без следующих вызовов", async (name, step, calls) => {
    const { source, callTool } = fakeSource({ [name]: { content: "  \n", isError: false } });
    await expect(runOutfitPipeline(source, "Омск")).rejects.toMatchObject({ code: "EMPTY_RESULT", step });
    expect(callTool).toHaveBeenCalledTimes(calls);
  });

  it("ошибка транспорта сохраняет шаг и исходную причину", async () => {
    const cause = new Error("timeout");
    const { source, callTool } = fakeSource({ recommend_outfit: cause });
    await expect(runOutfitPipeline(source, "Омск")).rejects.toMatchObject({
      code: "CALL_FAILED",
      step: "recommend",
      cause,
    });
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it.each(["", " О ", "x".repeat(101)])("некорректный город %j отклоняется до MCP-вызовов", async (city) => {
    const { source, callTool } = fakeSource();
    await expect(runOutfitPipeline(source, city)).rejects.toMatchObject({ code: "INVALID_LOCATION" });
    expect(() => requireOutfitLocation(city)).toThrow(OutfitError);
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("describeOutfitError", () => {
  it("называет шаг и причину", () => {
    const failed = new OutfitError("STEP_FAILED", { step: "weather", reason: "Место не найдено." });
    expect(describeOutfitError(failed)).toBe("Шаг «погода и прогноз» не выполнен: Место не найдено.");
    const call = new OutfitError("CALL_FAILED", { step: "recommend" });
    expect(describeOutfitError(call, "Истёк таймаут.")).toBe("Шаг «совет по одежде» не выполнен: Истёк таймаут.");
    expect(describeOutfitError(new OutfitError("EMPTY_RESULT", { step: "save" }))).toBe(
      "Шаг «сохранение совета» вернул пустой результат.",
    );
  });
});
