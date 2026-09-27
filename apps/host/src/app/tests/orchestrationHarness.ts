import { existsSync } from "node:fs";
import type {
  Message,
  ModelCompletion,
  ModelPort,
  ModelRequest,
  ToolDefinition,
  ToolResult,
  ToolSource,
} from "../../core/index.ts";
import { READ_HOST_MANIFEST, SAVE_DEPENDENCY_REPORT } from "../../features/dependencies/index.ts";
import type { StdioToolSourceOptions } from "../../features/mcp/index.ts";
import type { WithToolSource } from "../ask.ts";

export type CallLogEntry = Readonly<{ server: string; name: string; arguments: Record<string, unknown> }>;

const tool = (name: string): ToolDefinition => ({ name, inputSchema: { type: "object" } });

export const MANIFEST_TEXT = '{"name":"@mcp-lab/host","dependencies":{"zod":"4.5.4"}}';
export const NPM_TEXT = [
  "Пакет npm: zod",
  "Последняя версия (dist-tag latest): 4.6.5",
  "Лицензия: MIT",
  "Репозиторий: https://github.com/colinhacks/zod",
  "GitHub: owner=colinhacks, repo=zod",
].join("\n");
export const RELEASES_TEXT = [
  "Релизы GitHub colinhacks/zod (показано 1, новые сначала):",
  "- v4.6.5 — «v4.6.5», опубликован 2026-09-13T23:25:34Z — https://github.com/colinhacks/zod/releases/tag/v4.6.5",
].join("\n");
export const RELEASE_TEXT = [
  "Релиз GitHub colinhacks/zod v4.6.5",
  "Название: v4.6.5",
  "Опубликован: 2026-09-13T23:25:34Z",
  "Ссылка: https://github.com/colinhacks/zod/releases/tag/v4.6.5",
  "",
  "Заметки к релизу:\nИсправления и новые типы.",
].join("\n");

function fakeServerSession(
  log: CallLogEntry[],
  sessions: StdioToolSourceOptions[],
  tools: readonly ToolDefinition[],
  reply: (name: string, args: Record<string, unknown>) => ToolResult,
  onOpen?: (options: StdioToolSourceOptions) => void,
): WithToolSource {
  return async (options, use) => {
    sessions.push(options);
    onOpen?.(options);
    const source: ToolSource = {
      listTools: async () => tools,
      callTool: async (invocation) => {
        log.push({ server: options.serverName, name: invocation.name, arguments: invocation.arguments });
        return reply(invocation.name, invocation.arguments);
      },
    };
    return use(source);
  };
}

export type OrchestrationHarness = Readonly<{
  log: CallLogEntry[];
  openMeteoSessions: StdioToolSourceOptions[];
  schedulerSessions: StdioToolSourceOptions[];
  filesystemSessions: StdioToolSourceOptions[];
  npmSessions: StdioToolSourceOptions[];
  githubSessions: StdioToolSourceOptions[];
  reportsDirExistedAtOpen: boolean[];
  withWeatherToolSource: WithToolSource;
  withSchedulerToolSource: WithToolSource;
  withFilesystemToolSource: WithToolSource;
  withNpmToolSource: WithToolSource;
  withGithubToolSource: WithToolSource;
}>;

export type OrchestrationOverrides = Readonly<{
  githubReply?: (name: string, args: Record<string, unknown>) => ToolResult;
}>;

/** Пять fake-сессий: реалистичный listTools, журнал вызовов по серверу, заготовленные тексты серверов. */
export function createOrchestrationHarness(overrides: OrchestrationOverrides = {}): OrchestrationHarness {
  const log: CallLogEntry[] = [];
  const openMeteoSessions: StdioToolSourceOptions[] = [];
  const schedulerSessions: StdioToolSourceOptions[] = [];
  const filesystemSessions: StdioToolSourceOptions[] = [];
  const npmSessions: StdioToolSourceOptions[] = [];
  const githubSessions: StdioToolSourceOptions[] = [];
  const reportsDirExistedAtOpen: boolean[] = [];

  const withWeatherToolSource = fakeServerSession(log, openMeteoSessions, [tool("get_current_weather")], () => ({
    content: "Погода в Омске: 5°C, пасмурно.",
    isError: false,
  }));
  const withSchedulerToolSource = fakeServerSession(log, schedulerSessions, [tool("schedule_weather")], () => ({
    content: "не используется в этом сценарии",
    isError: true,
  }));
  const withFilesystemToolSource = fakeServerSession(
    log,
    filesystemSessions,
    ["read_text_file", "write_file", "move_file", "list_directory", "edit_file"].map(tool),
    (name, args) => {
      if (name === "read_text_file") return { content: MANIFEST_TEXT, isError: false };
      if (name === "write_file") return { content: `Successfully wrote to ${args.path}`, isError: false };
      return { content: "неизвестный вызов", isError: true };
    },
    (options) => reportsDirExistedAtOpen.push(existsSync(options.args.at(-1) ?? "")),
  );
  const withNpmToolSource = fakeServerSession(log, npmSessions, [tool("get_npm_package")], () => ({
    content: NPM_TEXT,
    isError: false,
  }));
  const defaultGithubReply = (name: string): ToolResult => ({
    content: name === "list_github_releases" ? RELEASES_TEXT : RELEASE_TEXT,
    isError: false,
  });
  const withGithubToolSource = fakeServerSession(
    log,
    githubSessions,
    [tool("list_github_releases"), tool("get_github_release")],
    overrides.githubReply ?? defaultGithubReply,
  );

  return {
    log,
    openMeteoSessions,
    schedulerSessions,
    filesystemSessions,
    npmSessions,
    githubSessions,
    reportsDirExistedAtOpen,
    withWeatherToolSource,
    withSchedulerToolSource,
    withFilesystemToolSource,
    withNpmToolSource,
    withGithubToolSource,
  };
}

function toolMessages(messages: readonly Message[]): readonly Extract<Message, { role: "tool" }>[] {
  return messages.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool");
}

function call(name: string, args: Record<string, unknown>): ModelCompletion {
  return { type: "tool_calls", calls: [{ id: `call-${name}`, name, arguments: args }] };
}

function weatherReply(userQuestion: string, round: number): ModelCompletion {
  if (round > 0) return { type: "text", content: "Сейчас в Омске облачно, 5°C." };
  const city = /в\s+([^\s?]+)/iu.exec(userQuestion)?.[1] ?? "Омске";
  return call("get_current_weather", { location: city });
}

/**
 * Раунд определяется числом уже полученных tool-сообщений; аргументы каждого следующего вызова
 * извлекаются регулярными выражениями из текстов предыдущих серверных ответов, а не из скрипта.
 */
function dependencyReply(messages: readonly Message[], round: number): ModelCompletion {
  const tools = toolMessages(messages);
  if (round === 0) return call(READ_HOST_MANIFEST, {});
  const manifestMatch = /"([\w.@/-]+)":\s*"([\d.]+)"/.exec(tools[0]?.content ?? "");
  const packageName = manifestMatch?.[1] ?? "";
  const currentVersion = manifestMatch?.[2] ?? "";
  if (round === 1) return call("get_npm_package", { name: packageName });
  const npmText = tools[1]?.content ?? "";
  const repoMatch = /GitHub: owner=(\S+), repo=(\S+)/.exec(npmText);
  const owner = repoMatch?.[1] ?? "";
  const repo = repoMatch?.[2] ?? "";
  if (round === 2) return call("list_github_releases", { owner, repo });
  const tag = /^- (\S+) —/m.exec(tools[2]?.content ?? "")?.[1] ?? "";
  if (round === 3) return call("get_github_release", { owner, repo, tag });
  const latestVersion = /dist-tag latest\): (\S+)/.exec(npmText)?.[1] ?? "";
  if (round === 4) {
    const markdown = [
      `# Обновление ${packageName}`,
      `Текущая версия: ${currentVersion}`,
      `Последняя версия: ${latestVersion}`,
      `Релиз: ${tag}`,
    ].join("\n");
    return call(SAVE_DEPENDENCY_REPORT, { packageName, markdown });
  }
  return { type: "text", content: `Рекомендую обновить ${packageName} до ${latestVersion}.` };
}

function userQuestionOf(request: ModelRequest): string {
  const message = request.messages[1];
  return message && "content" in message ? (message.content ?? "") : "";
}

/** Функция от запроса, а не фиксированный скрипт: следующий вызов зависит от накопленной истории. */
export const orchestrationModel: ModelPort = {
  async complete(request: ModelRequest): Promise<ModelCompletion> {
    const userQuestion = userQuestionOf(request);
    const round = toolMessages(request.messages).length;
    if (/погод/iu.test(userQuestion)) return weatherReply(userQuestion, round);
    return dependencyReply(request.messages, round);
  },
};
