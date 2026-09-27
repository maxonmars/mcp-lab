import { describe, expect, it, vi } from "vitest";
import type { ToolResult, ToolSource } from "../../../core/index.ts";
import { dependencyFilesToolSource } from "../files.ts";

const tool = (name: string) => ({ name, inputSchema: { type: "object" } });

function fullFilesystemSource(overrides: Partial<Record<string, ToolResult>> = {}) {
  const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
    if (overrides[name]) return overrides[name] as ToolResult;
    if (name === "read_text_file") return { content: '{"name":"@mcp-lab/host"}', isError: false };
    if (name === "write_file") return { content: `Successfully wrote to ${args.path}`, isError: false };
    return { content: "?", isError: true };
  });
  const source: ToolSource = {
    listTools: async () => [
      tool("read_text_file"),
      tool("write_file"),
      tool("move_file"),
      tool("list_directory"),
      tool("edit_file"),
    ],
    callTool,
  };
  return { source, callTool };
}

const options = { manifestPath: "/work/apps/host/package.json", reportsDir: "/work/.local/reports" };

describe("dependencyFilesToolSource: listTools", () => {
  it("скрывает сырые инструменты Filesystem и показывает только два фасада", async () => {
    const { source } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    expect((await projection.listTools()).map((item) => item.name)).toEqual([
      "read_host_manifest",
      "save_dependency_report",
    ]);
  });

  it("объявляет каждый фасад только при наличии соответствующего сырого инструмента", async () => {
    const onlyRead: ToolSource = { listTools: async () => [tool("read_text_file")], callTool: vi.fn() };
    const onlyWrite: ToolSource = { listTools: async () => [tool("write_file")], callTool: vi.fn() };
    expect((await dependencyFilesToolSource(onlyRead, options).listTools()).map((item) => item.name)).toEqual([
      "read_host_manifest",
    ]);
    expect((await dependencyFilesToolSource(onlyWrite, options).listTools()).map((item) => item.name)).toEqual([
      "save_dependency_report",
    ]);
  });
});

describe("read_host_manifest", () => {
  it("читает фиксированный путь и не принимает аргументов", async () => {
    const { source, callTool } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    const result = await projection.callTool({ name: "read_host_manifest", arguments: {} });
    expect(result).toEqual({ content: '{"name":"@mcp-lab/host"}', isError: false });
    expect(callTool).toHaveBeenCalledWith({ name: "read_text_file", arguments: { path: options.manifestPath } });
  });

  it("отклоняет любые аргументы до вызова read_text_file", async () => {
    const { source, callTool } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    await expect(
      projection.callTool({ name: "read_host_manifest", arguments: { path: "/etc/passwd" } }),
    ).resolves.toEqual({ isError: true, content: "read_host_manifest не принимает аргументов." });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("оборачивает isError сервера понятным текстом", async () => {
    const { source } = fullFilesystemSource({ read_text_file: { content: "ENOENT: package.json", isError: true } });
    const result = await dependencyFilesToolSource(source, options).callTool({
      name: "read_host_manifest",
      arguments: {},
    });
    expect(result).toEqual({ isError: true, content: "Манифест не прочитан: ENOENT: package.json" });
  });
});

describe("save_dependency_report", () => {
  it("вычисляет путь по packageName для обычного и scoped имени и возвращает путь", async () => {
    const { source, callTool } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    const result = await projection.callTool({
      name: "save_dependency_report",
      arguments: { packageName: "zod", markdown: "# Отчёт" },
    });
    expect(callTool).toHaveBeenCalledWith({
      name: "write_file",
      arguments: { path: "/work/.local/reports/dependency-zod.md", content: "# Отчёт\n" },
    });
    expect(result).toEqual({
      isError: false,
      content: "Отчёт сохранён в файл /work/.local/reports/dependency-zod.md.",
    });
    await projection.callTool({
      name: "save_dependency_report",
      arguments: { packageName: "@types/node", markdown: "# Отчёт" },
    });
    expect(callTool).toHaveBeenLastCalledWith({
      name: "write_file",
      arguments: { path: "/work/.local/reports/dependency-types__node.md", content: "# Отчёт\n" },
    });
  });

  it.each([
    [{ packageName: "../../etc", markdown: "# X" }, "Некорректное имя npm-пакета."],
    [{ packageName: "@a/b/c", markdown: "# X" }, "Некорректное имя npm-пакета."],
    [{ packageName: "zod", markdown: "  " }, "markdown не должен быть пустым."],
    [{ packageName: "zod", markdown: "x".repeat(20_001) }, "markdown длиннее 20000 символов."],
    [
      { packageName: "zod", markdown: "# X", path: "/etc/passwd" },
      "Лишний аргумент: save_dependency_report принимает только packageName и markdown.",
    ],
  ])("отклоняет некорректные аргументы до вызова write_file: %#", async (args, message) => {
    const { source, callTool } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    await expect(projection.callTool({ name: "save_dependency_report", arguments: args })).resolves.toEqual({
      isError: true,
      content: message,
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("оборачивает isError сервера понятным текстом", async () => {
    const { source } = fullFilesystemSource({ write_file: { content: "EACCES: permission denied", isError: true } });
    const result = await dependencyFilesToolSource(source, options).callTool({
      name: "save_dependency_report",
      arguments: { packageName: "zod", markdown: "# X" },
    });
    expect(result).toEqual({ isError: true, content: "Отчёт не сохранён: EACCES: permission denied" });
  });
});

describe("недоступные инструменты", () => {
  it("любое другое имя, включая сырые инструменты Filesystem, недоступно", async () => {
    const { source, callTool } = fullFilesystemSource();
    const projection = dependencyFilesToolSource(source, options);
    for (const name of ["move_file", "list_directory", "edit_file", "read_text_file", "write_file"]) {
      await expect(projection.callTool({ name, arguments: {} })).resolves.toMatchObject({ isError: true });
    }
    expect(callTool).not.toHaveBeenCalled();
  });
});
