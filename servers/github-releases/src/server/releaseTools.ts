import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { DEFAULT_RELEASES_LIMIT, MAX_RELEASES_LIMIT } from "../github/constants.ts";
import { describeGithubApiError } from "../github/errors.ts";
import {
  formatReleaseDetailsText,
  formatReleaseListText,
  githubReleaseDetailsSchema,
  githubReleaseListOutputSchema,
} from "../github/format.ts";
import { getGithubRelease, listGithubReleases } from "../github/releases.ts";
import type { GithubApiDependencies } from "../github/types.ts";

export const LIST_GITHUB_RELEASES_TOOL_NAME = "list_github_releases";
export const GET_GITHUB_RELEASE_TOOL_NAME = "get_github_release";

const ownerSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "Некорректное имя владельца GitHub.");
const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/, "Некорректное имя репозитория GitHub.")
  .refine((value) => value !== "." && value !== "..", { message: "Некорректное имя репозитория GitHub." });
const tagSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._@/+-]{1,200}$/, "Некорректный тег релиза.");

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

function registerListReleases(server: McpServer, deps: GithubApiDependencies): void {
  server.registerTool(
    LIST_GITHUB_RELEASES_TOOL_NAME,
    {
      description:
        "Возвращает список опубликованных релизов репозитория GitHub, новые сначала. Черновики не показываются.",
      inputSchema: z.object({
        owner: ownerSchema.describe("Владелец репозитория GitHub, например «colinhacks»."),
        repo: repoSchema.describe("Имя репозитория GitHub, например «zod»."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_RELEASES_LIMIT)
          .optional()
          .describe(`Сколько последних релизов вернуть, по умолчанию ${DEFAULT_RELEASES_LIMIT}.`),
      }),
      outputSchema: githubReleaseListOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, repo, limit }) => {
      try {
        const list = await listGithubReleases(owner, repo, limit ?? DEFAULT_RELEASES_LIMIT, deps);
        return { content: text(formatReleaseListText(list)), structuredContent: list };
      } catch (error) {
        return { isError: true, content: text(describeGithubApiError(error)) };
      }
    },
  );
}

function registerGetRelease(server: McpServer, deps: GithubApiDependencies): void {
  server.registerTool(
    GET_GITHUB_RELEASE_TOOL_NAME,
    {
      description: "Возвращает заметки и метаданные одного релиза репозитория GitHub по точному тегу.",
      inputSchema: z.object({
        owner: ownerSchema.describe("Владелец репозитория GitHub."),
        repo: repoSchema.describe("Имя репозитория GitHub."),
        tag: tagSchema.describe("Точный тег релиза, например «v4.6.5»."),
      }),
      outputSchema: githubReleaseDetailsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, repo, tag }) => {
      try {
        const details = await getGithubRelease(owner, repo, tag, deps);
        return { content: text(formatReleaseDetailsText(details)), structuredContent: details };
      } catch (error) {
        return { isError: true, content: text(describeGithubApiError(error)) };
      }
    },
  );
}

export function registerGithubReleaseTools(server: McpServer, deps: GithubApiDependencies): void {
  registerListReleases(server, deps);
  registerGetRelease(server, deps);
}
