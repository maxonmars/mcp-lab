import { describe, expect, it, vi } from "vitest";
import { Agent, AgentError } from "../index.ts";
import type { ModelCompletion, ModelRequest } from "../model.ts";
import type { ToolDefinition, ToolResult, ToolSource } from "../tool.ts";

const weatherTool: ToolDefinition = {
  name: "get_current_weather",
  description: "Текущая погода.",
  inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
};

function textCompletion(content: string): ModelCompletion {
  return { type: "text", content };
}

function fakeSource(overrides: Partial<ToolSource> = {}): ToolSource {
  return {
    listTools: vi.fn().mockResolvedValue([weatherTool]),
    callTool: vi.fn().mockResolvedValue({ content: "Ясно, 12°C", isError: false } satisfies ToolResult),
    ...overrides,
  };
}

describe("Agent без ToolSource", () => {
  it("выполняет один запрос модели и возвращает текст без tools", async () => {
    const complete = vi.fn().mockResolvedValue(textCompletion("Ответ"));
    const agent = new Agent({ complete }, "Системная инструкция");
    await expect(agent.respond("  Вопрос  ")).resolves.toBe("Ответ");
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0] as ModelRequest;
    expect(request).toEqual({
      messages: [
        { role: "system", content: "Системная инструкция" },
        { role: "user", content: "Вопрос" },
      ],
      tools: [],
      toolChoice: "none",
    });
  });

  it("не вызывает модель при пустом вводе", async () => {
    const complete = vi.fn();
    await expect(new Agent({ complete }, "").respond(" \n ")).rejects.toMatchObject({ code: "EMPTY_INPUT" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("Agent с ToolSource, но без вызова инструмента", () => {
  it("делает один запрос модели и не вызывает callTool", async () => {
    const complete = vi.fn().mockResolvedValue(textCompletion("Обычный ответ"));
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция");
    await expect(agent.respond("Вопрос", source)).resolves.toBe("Обычный ответ");
    expect(source.listTools).toHaveBeenCalledOnce();
    expect(source.callTool).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0] as ModelRequest;
    expect(request.tools).toEqual([weatherTool]);
    expect(request.toolChoice).toBe("auto");
  });
});

describe("Agent выполняет ровно один tool call", () => {
  it("вызывает source один раз и передаёт результат вторым запросом", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Новосибирск" } }],
      } satisfies ModelCompletion)
      .mockResolvedValueOnce(textCompletion("В Новосибирске ясно, 12°C."));
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция");
    await expect(agent.respond("Какая погода в Новосибирске?", source)).resolves.toBe("В Новосибирске ясно, 12°C.");
    expect(source.callTool).toHaveBeenCalledOnce();
    expect(source.callTool).toHaveBeenCalledWith({
      name: "get_current_weather",
      arguments: { location: "Новосибирск" },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1]?.[0] as ModelRequest;
    expect(second.toolChoice).toBe("none");
    expect(second.tools).toEqual([weatherTool]);
    expect(second.messages).toEqual([
      { role: "system", content: "Инструкция" },
      { role: "user", content: "Какая погода в Новосибирске?" },
      {
        role: "assistant",
        content: undefined,
        toolCalls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Новосибирск" } }],
      },
      { role: "tool", toolCallId: "call-1", content: "Ясно, 12°C" },
    ]);
  });

  it("передаёт модели isError результата и всё равно делает второй запрос", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Незнакогород" } }],
      } satisfies ModelCompletion)
      .mockResolvedValueOnce(textCompletion("Не удалось получить данные о погоде."));
    const source = fakeSource({
      callTool: vi.fn().mockResolvedValue({ content: "Место не найдено.", isError: true } satisfies ToolResult),
    });
    const agent = new Agent({ complete }, "Инструкция");
    await expect(agent.respond("Погода в Незнакогороде?", source)).resolves.toBe(
      "Не удалось получить данные о погоде.",
    );
    const second = complete.mock.calls[1]?.[0] as ModelRequest;
    expect(second.messages.at(-1)).toEqual({ role: "tool", toolCallId: "call-1", content: "Место не найдено." });
  });

  it("отклоняет неизвестный инструмент до вызова source", async () => {
    const complete = vi.fn().mockResolvedValue({
      type: "tool_calls",
      calls: [{ id: "call-1", name: "unknown_tool", arguments: {} }],
    } satisfies ModelCompletion);
    const source = fakeSource();
    await expect(new Agent({ complete }, "").respond("Вопрос", source)).rejects.toMatchObject({
      code: "UNKNOWN_TOOL_CALL",
    });
    expect(source.callTool).not.toHaveBeenCalled();
  });

  it("отклоняет несколько tool calls в одном ответе", async () => {
    const complete = vi.fn().mockResolvedValue({
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } },
        { id: "call-2", name: "get_current_weather", arguments: { location: "Томск" } },
      ],
    } satisfies ModelCompletion);
    const source = fakeSource();
    await expect(new Agent({ complete }, "").respond("Вопрос", source)).rejects.toMatchObject({
      code: "INVALID_TOOL_CALL_COUNT",
    });
    expect(source.callTool).not.toHaveBeenCalled();
  });

  it("отклоняет повторный tool call во втором ответе", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } }],
      } satisfies ModelCompletion)
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-2", name: "get_current_weather", arguments: { location: "Томск" } }],
      } satisfies ModelCompletion);
    const source = fakeSource();
    await expect(new Agent({ complete }, "").respond("Вопрос", source)).rejects.toMatchObject({
      code: "TOOL_CALL_LIMIT_EXCEEDED",
    });
    expect(source.callTool).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("отклоняет пустой финальный текст после tool call", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } }],
      } satisfies ModelCompletion)
      .mockResolvedValueOnce(textCompletion("  "));
    const source = fakeSource();
    await expect(new Agent({ complete }, "").respond("Вопрос", source)).rejects.toMatchObject({
      code: "EMPTY_RESPONSE",
    });
  });
});

describe("Independence между репликами", () => {
  it("после ошибки следующий respond() не хранит старые сообщения", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new AgentError("MODEL_FAILURE"))
      .mockResolvedValueOnce(textCompletion("OK"));
    const agent = new Agent({ complete }, "Инструкция");
    await expect(agent.respond("Первый")).rejects.toMatchObject({ code: "MODEL_FAILURE" });
    await expect(agent.respond("Второй")).resolves.toBe("OK");
    expect(complete).toHaveBeenCalledTimes(2);
    const request = complete.mock.calls[1]?.[0] as ModelRequest;
    expect(request.messages).toEqual([
      { role: "system", content: "Инструкция" },
      { role: "user", content: "Второй" },
    ]);
  });

  it("две подряд успешные реплики не накапливают историю", async () => {
    const complete = vi.fn().mockResolvedValue(textCompletion("Ответ"));
    const agent = new Agent({ complete }, "Инструкция");
    await agent.respond("Первый вопрос");
    await agent.respond("Второй вопрос");
    expect(complete.mock.calls[0]?.[0]).toEqual({
      messages: [
        { role: "system", content: "Инструкция" },
        { role: "user", content: "Первый вопрос" },
      ],
      tools: [],
      toolChoice: "none",
    });
    expect(complete.mock.calls[1]?.[0]).toEqual({
      messages: [
        { role: "system", content: "Инструкция" },
        { role: "user", content: "Второй вопрос" },
      ],
      tools: [],
      toolChoice: "none",
    });
  });
});
