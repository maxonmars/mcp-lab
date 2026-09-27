import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliView } from "../adapters/cli/index.ts";
import type { ToolSource } from "../core/index.ts";
import { Agent } from "../core/index.ts";
import { dependencyFilesToolSource } from "../features/dependencies/index.ts";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";
import { outfitToolSource } from "../features/outfit/index.ts";
import { schedulerServerArgs } from "../features/scheduler/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { dependencyReportsDir, filesystemOptions, githubReleasesOptions, npmRegistryOptions } from "./dependencies.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { observedToolSource, openMeteoOptions, outfitReportPath, type WithToolSource } from "./outfit.ts";
import { resolveHostManifest, resolveSchedulerEntrypoint, SERVER_NAMES } from "./serverEntrypoints.ts";
import { combineToolSources } from "./toolSources.ts";

export type { WithToolSource } from "./outfit.ts";

/** ADR 0007: несколько раундов вместо одного tool call — до пяти MCP-серверов за реплику ask. */
export const ASK_MAX_TOOL_CALLS = 6;

const promptFiles = [
  "./system.md",
  "../features/mcp/prompts/weatherTool.md",
  "../features/outfit/prompts/outfitTool.md",
  "../features/scheduler/prompts/scheduleTools.md",
  "../features/dependencies/prompts/dependencyTools.md",
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
  withFilesystemToolSource: WithToolSource;
  withNpmToolSource: WithToolSource;
  withGithubToolSource: WithToolSource;
  view: CliView;
  getConfig: () => ResolvedConfig;
}>;

function schedulerOptions(
  options: AskHandlerOptions,
  config: ResolvedConfig,
  timeoutMs: number,
): StdioToolSourceOptions {
  return {
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
    serverName: SERVER_NAMES.scheduler,
    timeoutMs,
  };
}

type AskSession = Readonly<{
  open: WithToolSource;
  options: StdioToolSourceOptions;
  expose: (source: ToolSource) => ToolSource;
}>;

/** Открывает сессии по одной, вложенно: каждая закрывается в finally своего withXToolSource. */
function withSessions(
  sessions: readonly AskSession[],
  use: (sources: readonly ToolSource[]) => Promise<string>,
  opened: readonly ToolSource[] = [],
): Promise<string> {
  const [next, ...rest] = sessions;
  if (!next) return use(opened);
  return next.open(next.options, (source) => withSessions(rest, use, [...opened, next.expose(source)]));
}

function askSessions(options: AskHandlerOptions, config: ResolvedConfig, view: CliView): AskSession[] {
  const timeoutMs = config.values["mcp.timeoutMs"];
  const reportsDir = dependencyReportsDir(options.cwd);
  const reportPath = outfitReportPath(options.cwd);
  return [
    {
      open: options.withWeatherToolSource,
      options: openMeteoOptions(options.cwd, options.nodeExecutable, config),
      expose: (source) => outfitToolSource(observedToolSource(source, view, SERVER_NAMES.openMeteo), { reportPath }),
    },
    {
      open: options.withSchedulerToolSource,
      options: schedulerOptions(options, config, timeoutMs),
      expose: (source) => observedToolSource(source, view, SERVER_NAMES.scheduler),
    },
    {
      open: options.withFilesystemToolSource,
      options: filesystemOptions(options.nodeExecutable, reportsDir, timeoutMs),
      expose: (source) =>
        dependencyFilesToolSource(observedToolSource(source, view, SERVER_NAMES.filesystem), {
          manifestPath: resolveHostManifest(),
          reportsDir,
        }),
    },
    {
      open: options.withNpmToolSource,
      options: npmRegistryOptions(options.nodeExecutable, timeoutMs),
      expose: (source) => observedToolSource(source, view, SERVER_NAMES.npmRegistry),
    },
    {
      open: options.withGithubToolSource,
      options: githubReleasesOptions(options.nodeExecutable, timeoutMs),
      expose: (source) => observedToolSource(source, view, SERVER_NAMES.githubReleases),
    },
  ];
}

/**
 * Один ask: до пяти MCP-сессий (Open‑Meteo, планировщик, Filesystem, npm-registry, github-releases) в одном
 * ToolSource. Статусы MCP печатаются на уровне серверных источников, поэтому фасады их не порождают.
 */
export function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  let agent: Agent | undefined;
  return async (text) => {
    const config = options.getConfig();
    agent ??= new Agent(createConfiguredModel(config, options.createModel), readSystemPrompt(), {
      maxToolCalls: ASK_MAX_TOOL_CALLS,
    });
    const currentAgent = agent;
    await mkdir(dependencyReportsDir(options.cwd), { recursive: true });
    const sessions = askSessions(options, config, options.view);
    return withSessions(sessions, (sources) => currentAgent.respond(text, combineToolSources(sources)));
  };
}
