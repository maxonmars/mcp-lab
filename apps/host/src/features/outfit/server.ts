import { GET_CURRENT_WEATHER, RECOMMEND_OUTFIT } from "./names.ts";

/** Относительно рабочего каталога host; MCP-серверу передаётся абсолютный путь. */
export const OUTFIT_REPORT_FILE = ".local/outfit/latest.md";

/** Геокодирование, текущая погода и почасовой прогноз выполняются сервером последовательно. */
const WEATHER_HTTP_REQUESTS = 3;

export type OutfitLlmConfig = Readonly<{ apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number }>;

export type OutfitServerConfig = Readonly<{
  nodeExecutable: string;
  /** Абсолютный путь к точке входа `servers/open-meteo`. */
  entrypoint: string;
  reportFile: string;
  mcpTimeoutMs: number;
  llm: OutfitLlmConfig;
}>;

/** Параметры stdio-запуска Open‑Meteo в outfit-режиме: SDK не наследует LAB_LLM_API_KEY без явного env. */
export function outfitServerOptions(config: OutfitServerConfig) {
  const { llm, mcpTimeoutMs } = config;
  return {
    command: config.nodeExecutable,
    args: [config.entrypoint, "--outfit-report-file", config.reportFile],
    timeoutMs: mcpTimeoutMs,
    env: {
      LAB_LLM_API_KEY: llm.apiKey,
      LAB_LLM_MODEL: llm.model,
      LAB_LLM_TIMEOUT_MS: String(llm.timeoutMs),
      LAB_LLM_MAX_OUTPUT_TOKENS: String(llm.maxOutputTokens),
    },
    callTimeoutsMs: {
      [GET_CURRENT_WEATHER]: mcpTimeoutMs * WEATHER_HTTP_REQUESTS,
      [RECOMMEND_OUTFIT]: llm.timeoutMs + mcpTimeoutMs,
    },
  };
}
