import { describe, expect, it, vi } from "vitest";
import type { ToolSource } from "../../core/index.ts";
import { combineToolSources } from "../toolSources.ts";

function source(names: string[], answer: string): ToolSource & { callTool: ReturnType<typeof vi.fn> } {
  return {
    listTools: async () => names.map((name) => ({ name, inputSchema: { type: "object" } })),
    callTool: vi.fn(async () => ({ content: answer, isError: false })),
  };
}

describe("combineToolSources", () => {
  it("объединяет инструменты в порядке источников и направляет вызов по имени", async () => {
    const weather = source(["get_current_weather"], "погода");
    const scheduler = source(["schedule_weather", "get_weather_summary"], "расписание");
    const combined = combineToolSources([weather, scheduler]);
    expect((await combined.listTools()).map((tool) => tool.name)).toEqual([
      "get_current_weather",
      "schedule_weather",
      "get_weather_summary",
    ]);
    expect(await combined.callTool({ name: "schedule_weather", arguments: { city: "Омск" } })).toEqual({
      content: "расписание",
      isError: false,
    });
    expect(scheduler.callTool).toHaveBeenCalledWith({ name: "schedule_weather", arguments: { city: "Омск" } });
    expect(weather.callTool).not.toHaveBeenCalled();
    await combined.callTool({ name: "get_current_weather", arguments: {} });
    expect(weather.callTool).toHaveBeenCalledOnce();
  });

  it("одинаковое имя у двух серверов — ошибка, а не молчаливое перекрытие", async () => {
    const combined = combineToolSources([source(["dup"], "a"), source(["dup"], "b")]);
    await expect(combined.listTools()).rejects.toThrow("одним именем");
  });

  it("вызов неизвестного инструмента не уходит ни в один источник", async () => {
    const one = source(["a"], "x");
    const combined = combineToolSources([one]);
    await combined.listTools();
    expect(() => combined.callTool({ name: "b", arguments: {} })).toThrow("не входит");
    expect(one.callTool).not.toHaveBeenCalled();
  });
});
