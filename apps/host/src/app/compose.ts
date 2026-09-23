import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliView, InputError, runCli, type Terminal } from "../adapters/cli/index.ts";
import { DeepSeekModel, type DeepSeekOptions } from "../adapters/llm/index.ts";
import { Agent, type ModelPort, type ToolSource } from "../core/index.ts";
import {
  discoverFilesystemTools,
  type FilesystemDiscoveryOptions,
  type McpDiscoveryResult,
  resolveOpenMeteoEntrypoint,
  type StdioToolSourceOptions,
  withStdioToolSource,
} from "../features/mcp/index.ts";
import { createCommands } from "./commands.ts";
import { parseOptions, type ResolvedConfig, resolveConfig, showConfig } from "./config.ts";

function readSystemPrompt(): string {
  const base = readFileSync(new URL("./system.md", import.meta.url), "utf8").trim();
  const weatherTool = readFileSync(new URL("../features/mcp/prompts/weatherTool.md", import.meta.url), "utf8").trim();
  return `${base}\n\n${weatherTool}`;
}

function observedToolSource(source: ToolSource, view: CliView): ToolSource {
  return {
    listTools: () => source.listTools(),
    callTool: async (invocation) => {
      try {
        const result = await source.callTool(invocation);
        view.mcpToolStatus(!result.isError);
        return result;
      } catch (error) {
        view.mcpToolStatus(false);
        throw error;
      }
    },
  };
}

type AskHandlerOptions = Readonly<{
  nodeExecutable: string;
  createModel: (options: DeepSeekOptions) => ModelPort;
  withWeatherToolSource: (
    options: StdioToolSourceOptions,
    use: (source: ToolSource) => Promise<string>,
  ) => Promise<string>;
  view: CliView;
  getConfig: () => ResolvedConfig;
}>;

function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  let agent: Agent | undefined;
  return (text) => {
    if (!agent) {
      const config = options.getConfig();
      const apiKey = config.values["llm.apiKey"];
      if (!apiKey) throw new InputError("Задайте LAB_LLM_API_KEY в окружении процесса.");
      const model = options.createModel({
        apiKey,
        model: config.values["llm.model"],
        timeoutMs: config.values["llm.timeoutMs"],
        maxOutputTokens: config.values["llm.maxOutputTokens"],
      });
      agent = new Agent(model, readSystemPrompt());
    }
    const currentAgent = agent;
    const timeoutMs = options.getConfig().values["mcp.timeoutMs"];
    return options.withWeatherToolSource(
      { command: options.nodeExecutable, args: [resolveOpenMeteoEntrypoint(import.meta.url)], timeoutMs },
      (source) => currentAgent.respond(text, observedToolSource(source, options.view)),
    );
  };
}

export async function run(options: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  nodeExecutable: string;
  terminal: Terminal;
  createModel?: (options: DeepSeekOptions) => ModelPort;
  discoverFilesystemTools?: (options: FilesystemDiscoveryOptions) => Promise<McpDiscoveryResult>;
  withWeatherToolSource?: (
    options: StdioToolSourceOptions,
    use: (source: ToolSource) => Promise<string>,
  ) => Promise<string>;
}): Promise<number> {
  let config: ResolvedConfig;
  const view = new CliView(options.terminal.output, options.terminal.error);
  const ask = createAskHandler({
    nodeExecutable: options.nodeExecutable,
    createModel: options.createModel ?? ((settings) => new DeepSeekModel(settings)),
    withWeatherToolSource: options.withWeatherToolSource ?? withStdioToolSource,
    view,
    getConfig: () => config,
  });
  const commands = createCommands({
    ask,
    config: () => showConfig(config),
    mcpTools: async () => {
      const discover = options.discoverFilesystemTools ?? discoverFilesystemTools;
      return discover({
        root: resolve(options.cwd, config.values["mcp.filesystemRoot"]),
        timeoutMs: config.values["mcp.timeoutMs"],
        nodeExecutable: options.nodeExecutable,
      });
    },
    view,
  });
  let command: string[];
  try {
    const parsed = parseOptions(
      options.argv,
      commands.flatMap((item) => item.aliases ?? []),
    );
    command = parsed.command;
    config = resolveConfig(parsed.flags, options.env, options.cwd);
  } catch (error) {
    view.error(error);
    return 1;
  }
  return runCli(commands, command, options.terminal, view);
}
