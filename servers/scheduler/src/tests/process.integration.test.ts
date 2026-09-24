import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness, observation, T0 } from "./harness.ts";

const MAIN = fileURLToPath(new URL("../app/main.ts", import.meta.url));

let harness: Harness;
const clients: { client: Client; transport: StdioClientTransport }[] = [];

afterEach(async () => {
  for (const { client, transport } of clients.splice(0)) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
  harness?.cleanup();
});

async function launch(...flags: string[]) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--disable-warning=ExperimentalWarning",
      MAIN,
      "--db",
      harness.dbPath,
      "--reports-dir",
      harness.reportsDir,
      ...flags,
    ],
    stderr: "ignore",
  });
  const client = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  clients.push({ client, transport });
  return { client, transport };
}

type Launched = Awaited<ReturnType<typeof launch>>;
const call = (launched: Launched, name: string, args: Record<string, unknown> = {}) =>
  launched.client.callTool({ name, arguments: args });

function waitForExit(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("процесс не завершился"));
        }
      } catch {
        clearInterval(timer);
        resolve();
      }
    }, 20);
  });
}

describe("scheduler MCP-сервер как процесс", () => {
  it("требует абсолютные пути и не пишет диагностику в stdout", () => {
    const result = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", MAIN, "--db", "relative.sqlite"],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("абсолютные пути");
  });

  it("согласование версии и список инструментов не создают базу; она открывается при первом вызове", async () => {
    harness = createHarness();
    const publicServer = await launch();
    expect((await publicServer.client.listTools()).tools).toHaveLength(3);
    expect(existsSync(harness.dbPath)).toBe(false);
    await call(publicServer, "schedule_weather", { city: "Омск", collectEverySeconds: 10, summaryEverySeconds: 60 });
    expect(existsSync(harness.dbPath)).toBe(true);
  });

  it("второй worker-процесс получает already_running; блокировка освобождается после закрытия и после SIGKILL", async () => {
    harness = createHarness();
    const first = await launch("--worker");
    expect((await call(first, "worker_start")).structuredContent).toEqual({ status: "started" });
    const second = await launch("--worker");
    expect((await call(second, "worker_start")).structuredContent).toEqual({ status: "already_running" });

    const firstPid = first.transport.pid ?? 0;
    await first.client.close();
    await waitForExit(firstPid);
    expect((await call(second, "worker_start")).structuredContent).toEqual({ status: "started" });

    const third = await launch("--worker");
    expect((await call(third, "worker_start")).structuredContent).toEqual({ status: "already_running" });
    const secondPid = second.transport.pid ?? 0;
    process.kill(secondPid, "SIGKILL");
    await waitForExit(secondPid);
    expect((await call(third, "worker_start")).structuredContent).toEqual({ status: "started" });
  });

  it("параллельные записи публичного и worker-процессов не теряются и не дают ошибок занятости", async () => {
    harness = createHarness();
    const publicServer = await launch();
    const worker = await launch("--worker");
    const created = await call(publicServer, "schedule_weather", {
      city: "Омск",
      collectEverySeconds: 10,
      summaryEverySeconds: 60,
    });
    const scheduleId = (created.structuredContent as { scheduleId: string }).scheduleId;
    await call(worker, "worker_start");

    const writes = 25;
    const results = await Promise.all([
      ...Array.from({ length: writes }, (_, index) =>
        call(worker, "worker_record_poll", {
          scheduleId,
          requestedAtMs: T0 + index * 1000,
          result: { ok: true, observation: observation() },
        }),
      ),
      ...Array.from({ length: writes }, (_, index) =>
        call(publicServer, "schedule_weather", {
          city: `Город ${index}`,
          collectEverySeconds: 10,
          summaryEverySeconds: 60,
        }),
      ),
    ]);
    expect(results.filter((result) => result.isError)).toEqual([]);
    const history = await call(worker, "worker_get_history", { scheduleId, fromMs: 0, toMs: T0 + 10 * writes * 1000 });
    expect((history.structuredContent as { polls: unknown[] }).polls).toHaveLength(writes);
    const due = await call(worker, "worker_get_due", { nowMs: Date.now() + 10 * 86_400_000 });
    expect((due.structuredContent as { tasks: unknown[] }).tasks).toHaveLength(writes + 1);
  });

  it("с --ignore-sigint процесс переживает SIGINT терминала, без флага — завершается", async () => {
    harness = createHarness();
    const ignoring = await launch("--worker", "--ignore-sigint");
    await ignoring.client.listTools();
    process.kill(ignoring.transport.pid ?? 0, "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await call(ignoring, "worker_start")).structuredContent).toEqual({ status: "started" });

    const plain = await launch();
    await plain.client.listTools();
    const pid = plain.transport.pid ?? 0;
    process.kill(pid, "SIGINT");
    await waitForExit(pid);
  });
});
