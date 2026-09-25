import { describe, expect, it, vi } from "vitest";
import { createDeepSeekAdvice } from "../outfit/deepseek.ts";

const options = { apiKey: "test-secret", model: "test-model", timeoutMs: 1000, maxOutputTokens: 321 };
const request = { instructions: "Инструкция", weatherText: "Погода" };

function response(message: Record<string, unknown>, finish_reason = "stop"): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...message }, finish_reason }] }), {
    headers: { "content-type": "application/json" },
  });
}

describe("DeepSeek-адаптер recommend_outfit", () => {
  it("делает один запрос с действующими параметрами, без reasoning и tools", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ content: "Совет" }));
    await expect(createDeepSeekAdvice({ ...options, fetch })(request)).resolves.toBe("Совет");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "Инструкция" },
        { role: "user", content: "Погода" },
      ],
      max_tokens: 321,
      thinking: { type: "disabled" },
    });
  });

  it("ошибку провайдера не повторяет и не раскрывает тело ответа", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "secret body" } }), { status: 500 }));
    const failure = createDeepSeekAdvice({ ...options, fetch })(request);
    await expect(failure).rejects.toMatchObject({ code: "MODEL_FAILURE", status: 500 });
    await expect(failure).rejects.not.toHaveProperty("message", expect.stringContaining("secret"));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("сетевой сбой — MODEL_FAILURE без статуса", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    await expect(createDeepSeekAdvice({ ...options, fetch })(request)).rejects.toMatchObject({
      code: "MODEL_FAILURE",
      status: undefined,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("незавершённый ответ — INCOMPLETE_RESPONSE", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ content: "Обре" }, "length"));
    await expect(createDeepSeekAdvice({ ...options, fetch })(request)).rejects.toMatchObject({
      code: "INCOMPLETE_RESPONSE",
    });
  });

  it.each([null, "   "])("пустой ответ %j — EMPTY_RESPONSE", async (content) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ content }));
    await expect(createDeepSeekAdvice({ ...options, fetch })(request)).rejects.toMatchObject({
      code: "EMPTY_RESPONSE",
    });
  });
});
