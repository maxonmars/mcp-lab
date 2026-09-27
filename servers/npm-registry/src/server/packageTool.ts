import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeNpmRegistryError } from "../registry/errors.ts";
import { formatNpmPackageText, npmPackageInfoSchema } from "../registry/format.ts";
import { fetchNpmPackage } from "../registry/package.ts";
import type { NpmRegistryDependencies } from "../registry/types.ts";

export const GET_NPM_PACKAGE_TOOL_NAME = "get_npm_package";

const NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

const inputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(214)
    .regex(NAME_PATTERN, "Имя пакета npm указано некорректно.")
    .describe("Точное имя пакета npm, например «zod» или «@types/node»."),
});

const TOOL_DESCRIPTION =
  "Возвращает последнюю опубликованную версию пакета npm (dist-tag latest), его описание, лицензию, " +
  "домашнюю страницу и репозиторий GitHub, если он указан. Передавай точное имя пакета, например из package.json.";

export function registerGetNpmPackage(server: McpServer, deps: NpmRegistryDependencies): void {
  server.registerTool(
    GET_NPM_PACKAGE_TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema,
      outputSchema: npmPackageInfoSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      try {
        const info = await fetchNpmPackage(name, deps);
        return { content: [{ type: "text" as const, text: formatNpmPackageText(info) }], structuredContent: info };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: describeNpmRegistryError(error) }] };
      }
    },
  );
}
