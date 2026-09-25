import { resolve } from "node:path";
import type { CliView } from "../adapters/cli/index.ts";
import type { ToolSource } from "../core/index.ts";
import { resolveOpenMeteoEntrypoint, type StdioToolSourceOptions } from "../features/mcp/index.ts";
import {
  OUTFIT_REPORT_FILE,
  outfitServerOptions,
  requireOutfitLocation,
  runOutfitPipeline,
} from "../features/outfit/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { requireApiKey } from "./model.ts";

export type WithToolSource = (
  options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<string>,
) => Promise<string>;

/** Строка `MCP: …` на каждый реальный вызов MCP-инструмента этого источника. */
export function observedToolSource(source: ToolSource, view: CliView): ToolSource {
  return {
    listTools: () => source.listTools(),
    callTool: async (invocation) => {
      try {
        const result = await source.callTool(invocation);
        view.mcpToolStatus(invocation.name, !result.isError);
        return result;
      } catch (error) {
        view.mcpToolStatus(invocation.name, false);
        throw error;
      }
    },
  };
}

export function outfitReportPath(cwd: string): string {
  return resolve(cwd, OUTFIT_REPORT_FILE);
}

/** Open‑Meteo в outfit-режиме: и для `outfit`, и для `ask`, где Agent видит только проекцию. */
export function openMeteoOptions(cwd: string, nodeExecutable: string, config: ResolvedConfig): StdioToolSourceOptions {
  const { values } = config;
  return outfitServerOptions({
    nodeExecutable,
    entrypoint: resolveOpenMeteoEntrypoint(import.meta.url),
    reportFile: outfitReportPath(cwd),
    mcpTimeoutMs: values["mcp.timeoutMs"],
    llm: {
      apiKey: requireApiKey(config),
      model: values["llm.model"],
      timeoutMs: values["llm.timeoutMs"],
      maxOutputTokens: values["llm.maxOutputTokens"],
    },
  });
}

export type OutfitHandlerOptions = Readonly<{
  cwd: string;
  nodeExecutable: string;
  withWeatherToolSource: WithToolSource;
  view: CliView;
  getConfig: () => ResolvedConfig;
}>;

/** Команда `outfit`: город и ключ проверяются до запуска MCP-сервера. */
export function createOutfitHandler(
  options: OutfitHandlerOptions,
): (city: string) => Promise<{ markdown: string; path: string }> {
  return async (city) => {
    const location = requireOutfitLocation(city);
    const serverOptions = openMeteoOptions(options.cwd, options.nodeExecutable, options.getConfig());
    const markdown = await options.withWeatherToolSource(serverOptions, async (source) => {
      const result = await runOutfitPipeline(observedToolSource(source, options.view), location);
      return result.markdown;
    });
    return { markdown, path: outfitReportPath(options.cwd) };
  };
}
