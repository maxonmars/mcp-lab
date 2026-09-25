import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

import { withStdioToolSource } from "../toolSource.ts";
import { resolveOpenMeteoEntrypoint } from "../weatherServerEntrypoint.ts";

afterEach(() => {
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

describe("Open-Meteo MCP по stdio", () => {
  it("получает список настоящего сервера без обращения к Open-Meteo и завершает процесс", async () => {
    const tools = await withStdioToolSource(
      {
        command: process.execPath,
        args: [resolveOpenMeteoEntrypoint(import.meta.url)],
        timeoutMs: 10_000,
      },
      (source) => source.listTools(),
    );
    expect(tools).toEqual([
      expect.objectContaining({ name: "get_current_weather", description: expect.stringMatching(/\S/) }),
    ]);
    expect(processIds).toHaveLength(1);
    const [pid] = processIds;
    if (pid === undefined) throw new Error("Open-Meteo MCP не предоставил ID дочернего процесса");
    await expectExit(pid);
  });

  it("в outfit-режиме с env объявляет три инструмента и не создаёт каталог отчёта заранее", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-lab-outfit-process-"));
    const reportFile = join(root, "outfit", "latest.md");
    try {
      const tools = await withStdioToolSource(
        {
          command: process.execPath,
          args: [resolveOpenMeteoEntrypoint(import.meta.url), "--outfit-report-file", reportFile],
          timeoutMs: 10_000,
          env: {
            LAB_LLM_API_KEY: "test-key",
            LAB_LLM_MODEL: "test-model",
            LAB_LLM_TIMEOUT_MS: "1000",
            LAB_LLM_MAX_OUTPUT_TOKENS: "100",
          },
        },
        (source) => source.listTools(),
      );
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_current_weather",
        "recommend_outfit",
        "save_outfit_advice",
      ]);
      expect(existsSync(join(root, "outfit"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("в outfit-режиме без ключа в env сервер не запускается", async () => {
    await expect(
      withStdioToolSource(
        {
          command: process.execPath,
          args: [resolveOpenMeteoEntrypoint(import.meta.url), "--outfit-report-file", join(tmpdir(), "latest.md")],
          timeoutMs: 10_000,
        },
        (source) => source.listTools(),
      ),
    ).rejects.toMatchObject({ name: "McpToolSourceError" });
  });
});
