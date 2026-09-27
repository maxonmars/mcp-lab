import { join } from "node:path";
import type { JsonObject, ToolDefinition, ToolResult, ToolSource } from "../../core/index.ts";
import { FILESYSTEM_READ, FILESYSTEM_WRITE, READ_HOST_MANIFEST, SAVE_DEPENDENCY_REPORT } from "./names.ts";
import { isNpmPackageName, MAX_REPORT_CHARS, reportFileName } from "./reportFile.ts";

export type DependencyFilesOptions = Readonly<{ manifestPath: string; reportsDir: string }>;

const readManifestDefinition: ToolDefinition = {
  name: READ_HOST_MANIFEST,
  description: "Читает манифест apps/host/package.json. Аргументов нет: путь задаёт приложение.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

const saveReportDefinition: ToolDefinition = {
  name: SAVE_DEPENDENCY_REPORT,
  description:
    "Сохраняет короткий Markdown-отчёт о зависимости в фиксированный каталог отчётов. Путь вычисляет " +
    "приложение из packageName, модель путь не передаёт; прежний отчёт того же пакета заменяется.",
  inputSchema: {
    type: "object",
    properties: {
      packageName: { type: "string", description: "Точное имя npm-пакета из манифеста, например «zod»." },
      markdown: { type: "string", description: "Готовый текст отчёта в Markdown." },
    },
    required: ["packageName", "markdown"],
    additionalProperties: false,
  },
};

async function readHostManifest(source: ToolSource, args: JsonObject, manifestPath: string): Promise<ToolResult> {
  if (Object.keys(args).length > 0) {
    return { isError: true, content: "read_host_manifest не принимает аргументов." };
  }
  const result = await source.callTool({ name: FILESYSTEM_READ, arguments: { path: manifestPath } });
  return result.isError ? { isError: true, content: `Манифест не прочитан: ${result.content}` } : result;
}

/** Первая найденная причина отказа; write_file не вызывается, пока аргументы не прошли все проверки. */
function invalidSaveArguments(args: JsonObject): string | undefined {
  const keys = Object.keys(args);
  if (keys.some((key) => key !== "packageName" && key !== "markdown")) {
    return "Лишний аргумент: save_dependency_report принимает только packageName и markdown.";
  }
  const { packageName, markdown } = args;
  if (typeof packageName !== "string" || !isNpmPackageName(packageName)) return "Некорректное имя npm-пакета.";
  if (typeof markdown !== "string" || markdown.trim().length === 0) return "markdown не должен быть пустым.";
  if (markdown.length > MAX_REPORT_CHARS) return `markdown длиннее ${MAX_REPORT_CHARS} символов.`;
  return undefined;
}

async function saveDependencyReport(
  source: ToolSource,
  args: JsonObject,
  options: DependencyFilesOptions,
): Promise<ToolResult> {
  const invalid = invalidSaveArguments(args);
  if (invalid) return { isError: true, content: invalid };
  const path = join(options.reportsDir, reportFileName(args.packageName as string));
  const markdown = args.markdown as string;
  const result = await source.callTool({
    name: FILESYSTEM_WRITE,
    arguments: { path, content: `${markdown.trimEnd()}\n` },
  });
  return result.isError
    ? { isError: true, content: `Отчёт не сохранён: ${result.content}` }
    : { isError: false, content: `Отчёт сохранён в файл ${path}.` };
}

/**
 * Проекция Filesystem MCP: модель видит только чтение манифеста host и сохранение отчёта о зависимости
 * из DEPENDENCY_REPORTS_DIR (`.local/reports`), а не сырые read_text_file/write_file.
 */
export function dependencyFilesToolSource(source: ToolSource, options: DependencyFilesOptions): ToolSource {
  return {
    listTools: async () => {
      const names = new Set((await source.listTools()).map((tool) => tool.name));
      const visible: ToolDefinition[] = [];
      if (names.has(FILESYSTEM_READ)) visible.push(readManifestDefinition);
      if (names.has(FILESYSTEM_WRITE)) visible.push(saveReportDefinition);
      return visible;
    },
    callTool: async (invocation) => {
      if (invocation.name === READ_HOST_MANIFEST) {
        return readHostManifest(source, invocation.arguments, options.manifestPath);
      }
      if (invocation.name === SAVE_DEPENDENCY_REPORT)
        return saveDependencyReport(source, invocation.arguments, options);
      return {
        isError: true,
        content: "Инструмент недоступен: файловые операции ограничены чтением манифеста и сохранением отчёта.",
      };
    },
  };
}
