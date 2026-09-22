import { describe, expect, it, vi } from "vitest";
import { DeepSeekModel } from "../index.ts";

const options = { apiKey: "test-secret", model: "test-model", timeoutMs: 1000, maxOutputTokens: 123 };
function response(content: string | null, finish_reason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason }] }), {
    headers: { "content-type": "application/json" },
  });
}

describe("DeepSeek adapter", () => {
  it("передаёт модель, сообщения и лимит; явно отключает reasoning", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response("Привет"));
    const model = new DeepSeekModel({ ...options, fetch });
    await expect(model.complete([{ role: "user", content: "Тест" }])).resolves.toBe("Привет");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "Тест" }],
      max_tokens: 123,
      thinking: { type: "disabled" },
    });
  });

  it("ошибка API содержит статус, но не тело ответа или ключ", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "test-secret" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const error = await new DeepSeekModel({ ...options, fetch }).complete([]).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "MODEL_FAILURE", data: { status: 401 } });
    expect(String(error)).not.toContain("test-secret");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("не повторяет запрос после сетевой ошибки", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("test-secret"));
    await expect(new DeepSeekModel({ ...options, fetch }).complete([])).rejects.toMatchObject({
      code: "MODEL_FAILURE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("возвращает отдельную ошибку при обрезанном ответе", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response("Часть", "length"));
    await expect(new DeepSeekModel({ ...options, fetch }).complete([])).rejects.toMatchObject({
      code: "INCOMPLETE_RESPONSE",
      data: { reason: "length" },
    });
  });
});
