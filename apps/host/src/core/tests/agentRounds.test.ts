import { describe, expect, it, type Mock, vi } from "vitest";
import { Agent } from "../index.ts";
import type { ModelCompletion, ModelRequest } from "../model.ts";
import type { ToolDefinition, ToolResult, ToolSource } from "../tool.ts";

/** complete.mock.calls[index]?.[0] напрямую с as ModelRequest ловит noUnsafeOptionalChaining. */
function requestAt(complete: Mock, index: number): ModelRequest {
  const call = complete.mock.calls[index];
  return call?.[0] as ModelRequest;
}

const toolA: ToolDefinition = { name: "tool_a", inputSchema: { type: "object" } };
const toolB: ToolDefinition = { name: "tool_b", inputSchema: { type: "object" } };

function textCompletion(content: string): ModelCompletion {
  return { type: "text", content };
}

function callCompletion(...calls: readonly { id: string; name: string }[]): ModelCompletion {
  return { type: "tool_calls", calls: calls.map((call) => ({ ...call, arguments: {} })) };
}

function fakeSource(overrides: Partial<ToolSource> = {}): ToolSource {
  return {
    listTools: vi.fn().mockResolvedValue([toolA, toolB]),
    callTool: vi.fn().mockResolvedValue({ content: "ok", isError: false } satisfies ToolResult),
    ...overrides,
  };
}

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Agent: несколько раундов до maxToolCalls", () => {
  it("делает по одному вызову за раунд, пока не исчерпан лимит, затем возвращает текст", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }))
      .mockResolvedValueOnce(callCompletion({ id: "call-2", name: "tool_b" }))
      .mockResolvedValueOnce(callCompletion({ id: "call-3", name: "tool_a" }))
      .mockResolvedValueOnce(textCompletion("Готово"));
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 3 });
    await expect(agent.respond("Вопрос", source)).resolves.toBe("Готово");
    expect(complete).toHaveBeenCalledTimes(4);
    expect(source.callTool).toHaveBeenCalledTimes(3);
    for (const call of complete.mock.calls.slice(0, 3)) expect((call[0] as ModelRequest).toolChoice).toBe("auto");
    expect(requestAt(complete, 3).toolChoice).toBe("none");
    const finalMessages = requestAt(complete, 3).messages;
    expect(finalMessages.slice(2)).toEqual([
      { role: "assistant", content: undefined, toolCalls: [{ id: "call-1", name: "tool_a", arguments: {} }] },
      { role: "tool", toolCallId: "call-1", content: "ok" },
      { role: "assistant", content: undefined, toolCalls: [{ id: "call-2", name: "tool_b", arguments: {} }] },
      { role: "tool", toolCallId: "call-2", content: "ok" },
      { role: "assistant", content: undefined, toolCalls: [{ id: "call-3", name: "tool_a", arguments: {} }] },
      { role: "tool", toolCallId: "call-3", content: "ok" },
    ]);
  });

  it("max = 2: toolChoice остаётся auto для первых двух раундов и none для третьего", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }))
      .mockResolvedValueOnce(callCompletion({ id: "call-2", name: "tool_b" }))
      .mockResolvedValueOnce(textCompletion("Готово"));
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    await expect(agent.respond("Вопрос", fakeSource())).resolves.toBe("Готово");
    expect(requestAt(complete, 0).toolChoice).toBe("auto");
    expect(requestAt(complete, 1).toolChoice).toBe("auto");
    expect(requestAt(complete, 2).toolChoice).toBe("none");
  });

  it("не изменяет ранее записанные запросы модели после следующих раундов", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }))
      .mockResolvedValueOnce(textCompletion("Готово"));
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    await agent.respond("Вопрос", fakeSource());
    expect(requestAt(complete, 0).messages).toHaveLength(2);
  });

  it("выполняет несколько вызовов одного ответа строго по порядку, не параллельно", async () => {
    const gate = deferredVoid();
    const order: string[] = [];
    const callTool = vi.fn(async (invocation: { name: string }) => {
      order.push(`start:${invocation.name}`);
      if (invocation.name === "tool_a") await gate.promise;
      order.push(`end:${invocation.name}`);
      return { content: `${invocation.name}-done`, isError: false } satisfies ToolResult;
    });
    const source = fakeSource({ callTool });
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }, { id: "call-2", name: "tool_b" }))
      .mockResolvedValueOnce(textCompletion("Готово"));
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    const responded = agent.respond("Вопрос", source);
    await vi.waitFor(() => expect(order).toEqual(["start:tool_a"]));
    gate.resolve();
    await expect(responded).resolves.toBe("Готово");
    expect(order).toEqual(["start:tool_a", "end:tool_a", "start:tool_b", "end:tool_b"]);
    const messages = requestAt(complete, 1).messages;
    expect(messages.slice(-2)).toEqual([
      { role: "tool", toolCallId: "call-1", content: "tool_a-done" },
      { role: "tool", toolCallId: "call-2", content: "tool_b-done" },
    ]);
  });

  it("[известный, неизвестный] отклоняется до вызова source", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(callCompletion({ id: "call-1", name: "tool_a" }, { id: "call-2", name: "unknown_tool" }));
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    await expect(agent.respond("Вопрос", source)).rejects.toMatchObject({ code: "UNKNOWN_TOOL_CALL" });
    expect(source.callTool).not.toHaveBeenCalled();
  });

  it("[валидный, аргументы-массив] отклоняется до вызова source", async () => {
    const badCompletion = {
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "tool_a", arguments: {} },
        { id: "call-2", name: "tool_b", arguments: [] },
      ],
    } as unknown as ModelCompletion;
    const complete = vi.fn().mockResolvedValue(badCompletion);
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    await expect(agent.respond("Вопрос", source)).rejects.toMatchObject({ code: "INVALID_TOOL_ARGUMENTS" });
    expect(source.callTool).not.toHaveBeenCalled();
  });

  it("max = 2: три вызова сразу превышают лимит", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        callCompletion(
          { id: "call-1", name: "tool_a" },
          { id: "call-2", name: "tool_b" },
          { id: "call-3", name: "tool_a" },
        ),
      );
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 2 });
    await expect(agent.respond("Вопрос", source)).rejects.toMatchObject({
      code: "TOOL_CALL_LIMIT_EXCEEDED",
      data: { limit: 2 },
    });
    expect(source.callTool).not.toHaveBeenCalled();
  });

  it("после исчерпания лимита повторный tool_calls тоже отклоняется", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }))
      .mockResolvedValueOnce(callCompletion({ id: "call-2", name: "tool_b" }));
    const source = fakeSource();
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 1 });
    await expect(agent.respond("Вопрос", source)).rejects.toMatchObject({
      code: "TOOL_CALL_LIMIT_EXCEEDED",
      data: { limit: 1 },
    });
    expect(source.callTool).toHaveBeenCalledOnce();
  });

  it("isError результата передаётся модели текстом, цикл продолжается", async () => {
    const callTool = vi.fn().mockResolvedValue({ content: "не найдено", isError: true } satisfies ToolResult);
    const source = fakeSource({ callTool });
    const complete = vi
      .fn()
      .mockResolvedValueOnce(callCompletion({ id: "call-1", name: "tool_a" }))
      .mockResolvedValueOnce(textCompletion("Не удалось."));
    const agent = new Agent({ complete }, "Инструкция", { maxToolCalls: 1 });
    await expect(agent.respond("Вопрос", source)).resolves.toBe("Не удалось.");
    const messages = requestAt(complete, 1).messages;
    expect(messages.at(-1)).toEqual({ role: "tool", toolCallId: "call-1", content: "не найдено" });
  });
});

describe("Agent: конструктор проверяет maxToolCalls", () => {
  it.each([0, -1, 1.5])("отклоняет maxToolCalls=%s", (maxToolCalls) => {
    expect(() => new Agent({ complete: vi.fn() }, "", { maxToolCalls })).toThrow(RangeError);
  });
});
