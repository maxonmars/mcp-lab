import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const processIds = vi.hoisted(() => [] as number[]);

vi.mock("@modelcontextprotocol/client/stdio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modelcontextprotocol/client/stdio")>();
  class TrackingStdioClientTransport extends actual.StdioClientTransport {
    override async start(): Promise<void> {
      await super.start();
      const pid = this.pid;
      if (pid !== null) processIds.push(pid);
    }
  }
  return { ...actual, StdioClientTransport: TrackingStdioClientTransport };
});

import { discoverFilesystemTools } from "../index.ts";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
  processIds.length = 0;
});

function hasExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
  }
}

async function expectExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!hasExited(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(hasExited(pid)).toBe(true);
}

describe("Filesystem MCP", () => {
  it("получает инструменты настоящего сервера и завершает дочерний процесс", async () => {
    root = mkdtempSync(join(tmpdir(), "mcp-lab-filesystem-"));
    const result = await discoverFilesystemTools({
      root,
      timeoutMs: 10_000,
      nodeExecutable: process.execPath,
    });
    const names = result.tools.map((tool) => tool.name);
    expect(result.server.name).not.toBe("");
    expect(result.server.version).not.toBe("");
    expect(names).toEqual(expect.arrayContaining(["read_text_file", "list_directory", "write_file"]));
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ["read_text_file", "list_directory", "write_file"]) {
      expect(result.tools.find((tool) => tool.name === name)?.description).toEqual(expect.stringMatching(/\S/));
    }
    expect(processIds).toHaveLength(1);
    const [pid] = processIds;
    if (pid === undefined) throw new Error("Filesystem MCP did not expose a child process ID");
    await expectExit(pid);
  });
});
