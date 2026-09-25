import { resolve } from "node:path";
import { CliView, runCli, type Terminal } from "../adapters/cli/index.ts";
import { DeepSeekModel, type DeepSeekOptions } from "../adapters/llm/index.ts";
import type { ModelPort } from "../core/index.ts";
import {
  discoverFilesystemTools,
  type FilesystemDiscoveryOptions,
  type McpDiscoveryResult,
  withStdioToolSource,
} from "../features/mcp/index.ts";
import type {
  Clock,
  Connect,
  SchedulerServerConfig,
  SummaryReadResult,
  WorkerSession,
  WorkerSessionConfig,
} from "../features/scheduler/index.ts";
import { createAskHandler, type WithToolSource } from "./ask.ts";
import { createCommands } from "./commands.ts";
import { parseOptions, type ResolvedConfig, resolveConfig, showConfig } from "./config.ts";
import { createOutfitHandler } from "./outfit.ts";
import { createSchedulerHandlers, type Interrupt } from "./scheduler.ts";

const neverInterrupted: Interrupt = () => ({ signal: new AbortController().signal, release: () => {} });

export type RunOptions = Readonly<{
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  nodeExecutable: string;
  terminal: Terminal;
  /** Создаёт сигнал остановки для `scheduler run`; SIGINT обрабатывает main.ts. */
  interrupt?: Interrupt;
  /** Часы worker; тесты подставляют управляемые. */
  clock?: Clock;
  createModel?: (options: DeepSeekOptions) => ModelPort;
  discoverFilesystemTools?: (options: FilesystemDiscoveryOptions) => Promise<McpDiscoveryResult>;
  withWeatherToolSource?: WithToolSource;
  withSchedulerToolSource?: WithToolSource;
  openWorkerSession?: (config: WorkerSessionConfig) => Promise<WorkerSession>;
  readSchedulerSummary?: (
    config: SchedulerServerConfig & Readonly<{ connect?: Connect | undefined }>,
    target: string,
  ) => Promise<SummaryReadResult>;
}>;

export async function run(options: RunOptions): Promise<number> {
  let config: ResolvedConfig;
  const view = new CliView(options.terminal.output, options.terminal.error);
  const createModel = options.createModel ?? ((settings: DeepSeekOptions) => new DeepSeekModel(settings));
  const getConfig = () => config;
  const weatherHandlerOptions = {
    cwd: options.cwd,
    nodeExecutable: options.nodeExecutable,
    withWeatherToolSource: options.withWeatherToolSource ?? withStdioToolSource,
    view,
    getConfig,
  };
  const ask = createAskHandler({
    ...weatherHandlerOptions,
    createModel,
    withSchedulerToolSource: options.withSchedulerToolSource ?? withStdioToolSource,
  });
  const outfit = createOutfitHandler(weatherHandlerOptions);
  const scheduler = createSchedulerHandlers({
    cwd: options.cwd,
    nodeExecutable: options.nodeExecutable,
    getConfig,
    createModel,
    view,
    interrupt: options.interrupt ?? neverInterrupted,
    clock: options.clock,
    openWorkerSession: options.openWorkerSession,
    readSummary: options.readSchedulerSummary,
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
    outfit,
    schedulerRun: scheduler.run,
    schedulerSummary: scheduler.summary,
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
