import { InputError } from "../adapters/cli/index.ts";
import type { DeepSeekOptions } from "../adapters/llm/index.ts";
import type { ModelPort } from "../core/index.ts";
import type { ResolvedConfig } from "./config.ts";

export type CreateModel = (options: DeepSeekOptions) => ModelPort;

export function requireApiKey(config: ResolvedConfig): string {
  const apiKey = config.values["llm.apiKey"];
  if (!apiKey) throw new InputError("Задайте LAB_LLM_API_KEY в окружении процесса.");
  return apiKey;
}

/** Модель создаётся лениво, поэтому справка, настройки и discovery работают без ключа. */
export function createConfiguredModel(config: ResolvedConfig, createModel: CreateModel): ModelPort {
  return createModel({
    apiKey: requireApiKey(config),
    model: config.values["llm.model"],
    timeoutMs: config.values["llm.timeoutMs"],
    maxOutputTokens: config.values["llm.maxOutputTokens"],
  });
}
