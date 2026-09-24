import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliView } from "../adapters/cli/index.ts";
import { Agent, type ToolSource } from "../core/index.ts";
import { resolveOpenMeteoEntrypoint, type StdioToolSourceOptions } from "../features/mcp/index.ts";
import { schedulerServerArgs } from "../features/scheduler/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { resolveSchedulerEntrypoint } from "./serverEntrypoints.ts";
import { combineToolSources } from "./toolSources.ts";

export type WithToolSource = (
  options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<string>,
) => Promise<string>;

const promptFiles = [
  "./system.md",
  "../features/mcp/prompts/weatherTool.md",
  "../features/scheduler/prompts/scheduleTools.md",
];

function readSystemPrompt(): string {
  return promptFiles.map((file) => readFileSync(new URL(file, import.meta.url), "utf8").trim()).join("\n\n");
}

function observedToolSource(source: ToolSource, view: CliView): ToolSource {
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

export type AskHandlerOptions = Readonly<{
  cwd: string;
  nodeExecutable: string;
  createModel: CreateModel;
  withWeatherToolSource: WithToolSource;
  withSchedulerToolSource: WithToolSource;
  view: CliView;
  getConfig: () => ResolvedConfig;
}>;

/** Один ask: два публичных MCP-сервера (погода и планировщик) в одном ToolSource, лимит вызовов держит Agent. */
export function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  let agent: Agent | undefined;
  return (text) => {
    const config = options.getConfig();
    agent ??= new Agent(createConfiguredModel(config, options.createModel), readSystemPrompt());
    const currentAgent = agent;
    const timeoutMs = config.values["mcp.timeoutMs"];
    const weather = {
      command: options.nodeExecutable,
      args: [resolveOpenMeteoEntrypoint(import.meta.url)],
      timeoutMs,
    };
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
    return options.withWeatherToolSource(weather, (weatherSource) =>
      options.withSchedulerToolSource(scheduler, (schedulerSource) =>
        currentAgent.respond(
          text,
          observedToolSource(combineToolSources([weatherSource, schedulerSource]), options.view),
        ),
      ),
    );
  };
}
