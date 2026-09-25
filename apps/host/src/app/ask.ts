import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliView } from "../adapters/cli/index.ts";
import { Agent } from "../core/index.ts";
import { outfitToolSource } from "../features/outfit/index.ts";
import { schedulerServerArgs } from "../features/scheduler/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { observedToolSource, openMeteoOptions, outfitReportPath, type WithToolSource } from "./outfit.ts";
import { resolveSchedulerEntrypoint } from "./serverEntrypoints.ts";
import { combineToolSources } from "./toolSources.ts";

export type { WithToolSource } from "./outfit.ts";

const promptFiles = [
  "./system.md",
  "../features/mcp/prompts/weatherTool.md",
  "../features/outfit/prompts/outfitTool.md",
  "../features/scheduler/prompts/scheduleTools.md",
];

function readSystemPrompt(): string {
  return promptFiles.map((file) => readFileSync(new URL(file, import.meta.url), "utf8").trim()).join("\n\n");
}

export type AskHandlerOptions = Readonly<{
  cwd: string;
  nodeExecutable: string;
  createModel: CreateModel;
  withWeatherToolSource: WithToolSource;
  withSchedulerToolSource: WithToolSource;
  view: CliView;
  getConfig: () => ResolvedConfig;
}>;

/**
 * Один ask: Open‑Meteo (через проекцию с фасадом совета по одежде) и публичный планировщик в одном ToolSource.
 * Статусы MCP печатаются на уровне серверных источников, поэтому фасад их не порождает.
 */
export function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  let agent: Agent | undefined;
  return (text) => {
    const config = options.getConfig();
    agent ??= new Agent(createConfiguredModel(config, options.createModel), readSystemPrompt());
    const currentAgent = agent;
    const timeoutMs = config.values["mcp.timeoutMs"];
    const weather = openMeteoOptions(options.cwd, options.nodeExecutable, config);
    const scheduler = {
      command: options.nodeExecutable,
      args: schedulerServerArgs(
        {
          nodeExecutable: options.nodeExecutable,
          entrypoint: resolveSchedulerEntrypoint(import.meta.url),
          dbPath: resolve(options.cwd, config.values["scheduler.dbPath"]),
          reportsDir: resolve(options.cwd, config.values["scheduler.reportsDir"]),
          timeoutMs,
        },
        "public",
      ),
      timeoutMs,
    };
    const reportPath = outfitReportPath(options.cwd);
    return options.withWeatherToolSource(weather, (weatherSource) =>
      options.withSchedulerToolSource(scheduler, (schedulerSource) =>
        currentAgent.respond(
          text,
          combineToolSources([
            outfitToolSource(observedToolSource(weatherSource, options.view), { reportPath }),
            observedToolSource(schedulerSource, options.view),
          ]),
        ),
      ),
    );
  };
}
