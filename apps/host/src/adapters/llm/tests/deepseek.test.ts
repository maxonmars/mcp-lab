import { describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../../core/model.ts";
import { DeepSeekModel } from "../index.ts";

const options = { apiKey: "test-secret", model: "test-model", timeoutMs: 1000, maxOutputTokens: 123 };
const weatherTool = {
  name: "get_current_weather",
  description: "Текущая погода.",
  inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
};

function response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [body] }), { headers: { "content-type": "application/json" } });
}

function textResponse(content: string | null, finish_reason = "stop"): Response {
  return response({ message: { role: "assistant", content }, finish_reason });
}

function toolCallResponse(): Response {
  return response({
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "get_current_weather", arguments: '{"location":"Омск"}' } },
      ],
    },
    finish_reason: "tool_calls",
  });
}

function textRequest(): ModelRequest {
  return { messages: [{ role: "user", content: "Тест" }], tools: [], toolChoice: "none" };
}

describe("DeepSeek adapter: простой запрос без tools", () => {
  it("не добавляет tools и tool_choice, когда список инструментов пуст", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(textResponse("Привет"));
    const model = new DeepSeekModel({ ...options, fetch });
    await expect(model.complete(textRequest())).resolves.toEqual({ type: "text", content: "Привет" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "Тест" }],
      max_tokens: 123,
      thinking: { type: "disabled" },
    });
  });
});

describe("DeepSeek adapter: tool calling", () => {
  it("первый tool-aware запрос содержит function-схему и tool_choice auto", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(textResponse("Ответ без инструмента"));
    const model = new DeepSeekModel({ ...options, fetch });
    const request: ModelRequest = {
      messages: [{ role: "user", content: "Погода в Омске?" }],
      tools: [weatherTool],
      toolChoice: "auto",
    };
    await model.complete(request);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "get_current_weather", description: "Текущая погода.", parameters: weatherTool.inputSchema },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
  });

  it("разбирает finish_reason tool_calls в ModelCompletion с распарсенными arguments", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(toolCallResponse());
    const model = new DeepSeekModel({ ...options, fetch });
    await expect(model.complete({ messages: [], tools: [weatherTool], toolChoice: "auto" })).resolves.toEqual({
      type: "tool_calls",
      content: undefined,
      calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } }],
    });
  });

  it("второй запрос передаёт assistant tool_calls, tool-результат и tool_choice none", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(textResponse("В Омске ясно."));
    const model = new DeepSeekModel({ ...options, fetch });
    const request: ModelRequest = {
      messages: [
        { role: "system", content: "Инструкция" },
        { role: "user", content: "Погода в Омске?" },
        {
          role: "assistant",
          toolCalls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } }],
        },
        { role: "tool", toolCallId: "call-1", content: "Ясно, 12°C" },
      ],
      tools: [weatherTool],
      toolChoice: "none",
    };
    await model.complete(request);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.tool_choice).toBe("none");
    expect(body.messages[2]).toEqual({
      role: "assistant",
      content: undefined,
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "get_current_weather", arguments: '{"location":"Омск"}' } },
      ],
    });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call-1", content: "Ясно, 12°C" });
  });

  it.each(["not-json", "null", "[1,2]"])("отклоняет некорректные arguments: %s", async (args) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "get_current_weather", arguments: args } }],
        },
        finish_reason: "tool_calls",
      }),
    );
    const model = new DeepSeekModel({ ...options, fetch });
    await expect(model.complete({ messages: [], tools: [weatherTool], toolChoice: "auto" })).rejects.toMatchObject({
      code: "INVALID_TOOL_ARGUMENTS",
    });
  });

  it("отклоняет пустой tool_calls при finish_reason tool_calls", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response({ message: { role: "assistant", content: null, tool_calls: [] }, finish_reason: "tool_calls" }),
      );
    const model = new DeepSeekModel({ ...options, fetch });
    await expect(model.complete({ messages: [], tools: [weatherTool], toolChoice: "auto" })).rejects.toMatchObject({
      code: "INVALID_TOOL_CALL_COUNT",
    });
  });
});

describe("DeepSeek adapter: ошибки и надёжность", () => {
  it("ошибка API содержит статус, но не тело ответа или ключ", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "test-secret" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const error = await new DeepSeekModel({ ...options, fetch })
      .complete(textRequest())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "MODEL_FAILURE", data: { status: 401 } });
    expect(String(error)).not.toContain("test-secret");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("не повторяет запрос после сетевой ошибки", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("test-secret"));
    await expect(new DeepSeekModel({ ...options, fetch }).complete(textRequest())).rejects.toMatchObject({
      code: "MODEL_FAILURE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("возвращает отдельную ошибку при обрезанном ответе", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(textResponse("Часть", "length"));
    await expect(new DeepSeekModel({ ...options, fetch }).complete(textRequest())).rejects.toMatchObject({
      code: "INCOMPLETE_RESPONSE",
      data: { reason: "length" },
    });
  });
});
