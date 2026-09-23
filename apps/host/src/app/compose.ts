import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliView, InputError, runCli, type Terminal } from "../adapters/cli/index.ts";
import { DeepSeekModel, type DeepSeekOptions } from "../adapters/llm/index.ts";
import { Agent, type ModelPort } from "../core/index.ts";
import {
  discoverFilesystemTools,
  type FilesystemDiscoveryOptions,
  type McpDiscoveryResult,
} from "../features/mcp/index.ts";
import { createCommands } from "./commands.ts";
import { parseOptions, type ResolvedConfig, resolveConfig, showConfig } from "./config.ts";

export async function run(options: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  nodeExecutable: string;
  terminal: Terminal;
  createModel?: (options: DeepSeekOptions) => ModelPort;
  discoverFilesystemTools?: (options: FilesystemDiscoveryOptions) => Promise<McpDiscoveryResult>;
}): Promise<number> {
  let agent: Agent | undefined;
  let config: ResolvedConfig;
  const view = new CliView(options.terminal.output, options.terminal.error);
  const commands = createCommands({
    ask: (text) => {
      if (!agent) {
        const apiKey = config.values["llm.apiKey"];
        if (!apiKey) throw new InputError("Задайте LAB_LLM_API_KEY в окружении процесса.");
        const model = (options.createModel ?? ((settings) => new DeepSeekModel(settings)))({
          apiKey,
          model: config.values["llm.model"],
          timeoutMs: config.values["llm.timeoutMs"],
          maxOutputTokens: config.values["llm.maxOutputTokens"],
        });
        agent = new Agent(model, readFileSync(new URL("./system.md", import.meta.url), "utf8"));
      }
      return agent.respond(text);
    },
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
