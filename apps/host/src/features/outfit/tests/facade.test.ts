import { describe, expect, it, vi } from "vitest";
import { Agent, type ModelCompletion, type ModelRequest, type ToolSource } from "../../../core/index.ts";
import { outfitToolSource } from "../facade.ts";
import { outfitServerOptions } from "../server.ts";

const tool = (name: string) => ({ name, inputSchema: { type: "object" } });
const fullTools = ["get_current_weather", "recommend_outfit", "save_outfit_advice"].map(tool);

function fullSource(overrides: Partial<Record<string, { content: string; isError: boolean }>> = {}) {
  const callTool = vi.fn(async ({ name }: { name: string }) => {
    const replies: Record<string, { content: string; isError: boolean }> = {
      get_current_weather: { content: "Погода.", isError: false },
      recommend_outfit: { content: "# Совет\n", isError: false },
      save_outfit_advice: { content: "Сохранено.", isError: false },
    };
    return overrides[name] ?? replies[name] ?? { content: "?", isError: true };
  });
  const source: ToolSource = { listTools: async () => fullTools, callTool };
  return { source, callTool };
}

const options = { reportPath: "/work/.local/outfit/latest.md" };

describe("outfitToolSource", () => {
  it("показывает get_current_weather и фасад, скрывая внутренние шаги", async () => {
    const projection = outfitToolSource(fullSource().source, options);
    expect((await projection.listTools()).map((item) => item.name)).toEqual([
      "get_current_weather",
      "prepare_outfit_advice",
    ]);
  });

  it("без полного набора инструментов фасад не объявляется", async () => {
    const source: ToolSource = { listTools: async () => [tool("get_current_weather")], callTool: vi.fn() };
    expect((await outfitToolSource(source, options).listTools()).map((item) => item.name)).toEqual([
      "get_current_weather",
    ]);
  });

  it("запрещает прямой вызов внутренних шагов", async () => {
    const { source, callTool } = fullSource();
    const projection = outfitToolSource(source, options);
    for (const name of ["recommend_outfit", "save_outfit_advice"]) {
      await expect(projection.callTool({ name, arguments: {} })).rejects.toMatchObject({ code: "HIDDEN_TOOL" });
    }
    expect(callTool).not.toHaveBeenCalled();
  });

  it("get_current_weather передаётся источнику без изменений", async () => {
    const { source, callTool } = fullSource();
    const invocation = { name: "get_current_weather", arguments: { location: "Омск" } };
    await expect(outfitToolSource(source, options).callTool(invocation)).resolves.toEqual({
      content: "Погода.",
      isError: false,
    });
    expect(callTool).toHaveBeenCalledWith(invocation);
  });

  it("фасад запускает пайплайн и возвращает совет с путём файла", async () => {
    const { source, callTool } = fullSource();
    const result = await outfitToolSource(source, options).callTool({
      name: "prepare_outfit_advice",
      arguments: { location: "Омск" },
    });
    expect(result).toEqual({
      isError: false,
      content: "# Совет\n\nСовет сохранён в файл /work/.local/outfit/latest.md.",
    });
    expect(callTool.mock.calls.map(([invocation]) => invocation.name)).toEqual([
      "get_current_weather",
      "recommend_outfit",
      "save_outfit_advice",
    ]);
  });

  it("ошибка шага возвращается модели как безопасный isError-результат", async () => {
    const { source, callTool } = fullSource({
      recommend_outfit: { content: "Модель DeepSeek вернула пустой ответ.", isError: true },
    });
    const projection = outfitToolSource(source, options);
    await expect(
      projection.callTool({ name: "prepare_outfit_advice", arguments: { location: "Омск" } }),
    ).resolves.toEqual({
      isError: true,
      content: "Шаг «совет по одежде» не выполнен: Модель DeepSeek вернула пустой ответ.",
    });
    expect(callTool).toHaveBeenCalledTimes(2);
    await expect(projection.callTool({ name: "prepare_outfit_advice", arguments: {} })).resolves.toMatchObject({
      isError: true,
      content: "Укажите город: от 2 до 100 символов.",
    });
  });

  it("Agent с fake ModelPort выбирает фасад: одна реплика — один tool call и три MCP-вызова", async () => {
    const { source, callTool } = fullSource();
    const complete = vi
      .fn<(request: ModelRequest) => Promise<ModelCompletion>>()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "prepare_outfit_advice", arguments: { location: "Омск" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Наденьте куртку." });
    const answer = await new Agent({ complete }, "system").respond(
      "Что надеть в Омске?",
      outfitToolSource(source, options),
    );
    expect(answer).toBe("Наденьте куртку.");
    expect(complete.mock.calls[0]?.[0].tools.map((item) => item.name)).toEqual([
      "get_current_weather",
      "prepare_outfit_advice",
    ]);
    expect(callTool).toHaveBeenCalledTimes(3);
    const toolMessage = complete.mock.calls[1]?.[0].messages.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", content: expect.stringContaining("# Совет") });
  });
});

describe("outfitServerOptions", () => {
  it("передаёт путь файла, параметры DeepSeek через env и таймауты по имени инструмента", () => {
    const llm = { apiKey: "key", model: "deepseek-flash", timeoutMs: 30_000, maxOutputTokens: 1024 };
    expect(
      outfitServerOptions({
        nodeExecutable: "node",
        entrypoint: "/srv/main.ts",
        reportFile: "/work/.local/outfit/latest.md",
        mcpTimeoutMs: 10_000,
        llm,
      }),
    ).toEqual({
      command: "node",
      args: ["/srv/main.ts", "--outfit-report-file", "/work/.local/outfit/latest.md"],
      timeoutMs: 10_000,
      env: {
        LAB_LLM_API_KEY: "key",
        LAB_LLM_MODEL: "deepseek-flash",
        LAB_LLM_TIMEOUT_MS: "30000",
        LAB_LLM_MAX_OUTPUT_TOKENS: "1024",
      },
      callTimeoutsMs: { get_current_weather: 30_000, recommend_outfit: 40_000 },
    });
  });
});
