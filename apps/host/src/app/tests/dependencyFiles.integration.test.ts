import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dependencyFilesToolSource } from "../../features/dependencies/index.ts";
import { resolveFilesystemEntrypoint, withStdioToolSource } from "../../features/mcp/index.ts";

let root: string;
beforeEach(() => {
  // tmpdir() на macOS — симлинк /var → /private/var; Filesystem-сервер сверяет путь буквально.
  root = realpathSync(mkdtempSync(join(tmpdir(), "mcp-lab-dependency-files-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("dependencyFilesToolSource поверх настоящего Filesystem MCP", () => {
  it("читает манифест и дважды сохраняет отчёт без временных файлов рядом", async () => {
    const hostDir = join(root, "host");
    const reportsDir = join(root, "reports");
    mkdirSync(hostDir);
    mkdirSync(reportsDir);
    const manifestPath = join(hostDir, "package.json");
    writeFileSync(manifestPath, '{"name":"@mcp-lab/host","dependencies":{"zod":"4.5.4"}}');

    await withStdioToolSource(
      {
        command: process.execPath,
        args: [resolveFilesystemEntrypoint(), hostDir, reportsDir],
        serverName: "filesystem",
        timeoutMs: 10_000,
      },
      async (source) => {
        const projection = dependencyFilesToolSource(source, { manifestPath, reportsDir });
        expect((await projection.listTools()).map((tool) => tool.name)).toEqual([
          "read_host_manifest",
          "save_dependency_report",
        ]);

        const manifest = await projection.callTool({ name: "read_host_manifest", arguments: {} });
        expect(manifest.isError).toBe(false);
        expect(manifest.content).toContain('"zod":"4.5.4"');

        const first = await projection.callTool({
          name: "save_dependency_report",
          arguments: { packageName: "zod", markdown: "# Первый отчёт" },
        });
        expect(first.isError).toBe(false);
        const reportPath = join(reportsDir, "dependency-zod.md");
        expect(readFileSync(reportPath, "utf8")).toBe("# Первый отчёт\n");

        const second = await projection.callTool({
          name: "save_dependency_report",
          arguments: { packageName: "zod", markdown: "# Второй отчёт" },
        });
        expect(second.isError).toBe(false);
        expect(readFileSync(reportPath, "utf8")).toBe("# Второй отчёт\n");
      },
    );

    const reportFiles = readdirSync(reportsDir);
    expect(reportFiles).toEqual(["dependency-zod.md"]);
    expect(reportFiles.some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});
