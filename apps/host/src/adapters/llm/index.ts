import OpenAI from "openai";
import { AgentError, type Message, type ModelPort } from "../../core/index.ts";

export type DeepSeekOptions = Readonly<{
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetch?: typeof globalThis.fetch;
}>;

export class DeepSeekModel implements ModelPort {
  readonly #client: OpenAI;
  readonly #options: DeepSeekOptions;

  constructor(options: DeepSeekOptions) {
    this.#options = { ...options };
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: "https://api.deepseek.com",
      timeout: options.timeoutMs,
      maxRetries: 0,
      fetch: options.fetch,
    });
  }

  async complete(messages: readonly Message[]): Promise<string> {
    try {
      const request = {
        model: this.#options.model,
        messages: messages.map((message) => ({ ...message })),
        max_tokens: this.#options.maxOutputTokens,
        thinking: { type: "disabled" },
      };
      const response = await this.#client.chat.completions.create(request);
      const choice = response.choices[0];
      if (!choice) throw new AgentError("EMPTY_RESPONSE");
      if (choice.finish_reason !== "stop") {
        throw new AgentError("INCOMPLETE_RESPONSE", { reason: choice.finish_reason });
      }
      return choice.message.content ?? "";
    } catch (error) {
      if (error instanceof AgentError) throw error;
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      throw new AgentError("MODEL_FAILURE", status === undefined ? {} : { status });
    }
  }
}
