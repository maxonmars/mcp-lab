import OpenAI from "openai";

export type AdviceModelOptions = Readonly<{
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetch?: typeof globalThis.fetch;
}>;

export type AdviceRequest = Readonly<{ instructions: string; weatherText: string }>;
export type GenerateAdvice = (request: AdviceRequest) => Promise<string>;

export type AdviceModelErrorCode = "MODEL_FAILURE" | "INCOMPLETE_RESPONSE" | "EMPTY_RESPONSE";

/** Хранит только код и HTTP-статус: тело ошибки провайдера и ключ не покидают адаптер. */
export class AdviceModelError extends Error {
  readonly code: AdviceModelErrorCode;
  readonly status: number | undefined;

  constructor(code: AdviceModelErrorCode, status?: number) {
    super(code);
    this.name = "AdviceModelError";
    this.code = code;
    this.status = status;
  }
}

/** Один запрос к DeepSeek на совет: без инструментов, без reasoning и без повторов SDK. */
export function createDeepSeekAdvice(options: AdviceModelOptions): GenerateAdvice {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: "https://api.deepseek.com",
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: options.fetch,
  });
  return async ({ instructions, weatherText }) => {
    const wireRequest = {
      model: options.model,
      messages: [
        { role: "system" as const, content: instructions },
        { role: "user" as const, content: weatherText },
      ],
      max_tokens: options.maxOutputTokens,
      thinking: { type: "disabled" },
    };
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create(wireRequest);
    } catch (error) {
      throw new AdviceModelError("MODEL_FAILURE", error instanceof OpenAI.APIError ? error.status : undefined);
    }
    const choice = response.choices[0];
    if (!choice) throw new AdviceModelError("EMPTY_RESPONSE");
    if (choice.finish_reason !== "stop") throw new AdviceModelError("INCOMPLETE_RESPONSE");
    const content = choice.message.content ?? "";
    if (!content.trim()) throw new AdviceModelError("EMPTY_RESPONSE");
    return content;
  };
}
