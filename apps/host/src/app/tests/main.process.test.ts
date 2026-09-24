import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MAIN = fileURLToPath(new URL("../main.ts", import.meta.url));

let root: string;
let child: ChildProcess | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-main-"));
});
afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
  rmSync(root, { recursive: true, force: true });
});

function startWorker() {
  const process_ = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      MAIN,
      "--scheduler-db-path",
      join(root, "scheduler.sqlite"),
      "--scheduler-reports-dir",
      join(root, "reports"),
      "scheduler",
      "run",
    ],
    {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", LAB_LLM_API_KEY: "test-key" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child = process_;
  const state = { out: "", err: "" };
  process_.stdout?.on("data", (chunk) => (state.out += chunk));
  process_.stderr?.on("data", (chunk) => (state.err += chunk));
  const exited = new Promise<number | null>((resolve) => process_.once("exit", (code) => resolve(code)));
  return { process: process_, state, exited };
}

describe("main.ts: scheduler run как процесс", () => {
  it("двойной SIGINT (npm пересылает сигнал) останавливает worker штатно, повторный запуск возможен", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const worker = startWorker();
      await vi.waitFor(() => expect(worker.state.out).toContain("Планировщик запущен"), { timeout: 15_000 });
      worker.process.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 20));
      worker.process.kill("SIGINT");
      expect(await worker.exited).toBe(0);
      expect(worker.state.out).toContain("Планировщик остановлен.");
      expect(worker.state.err).not.toContain("Ошибка");
    }
  });

  it("SIGTERM тоже останавливает worker штатно", async () => {
    const worker = startWorker();
    await vi.waitFor(() => expect(worker.state.out).toContain("Планировщик запущен"), { timeout: 15_000 });
    worker.process.kill("SIGTERM");
    expect(await worker.exited).toBe(0);
    expect(worker.state.out).toContain("Планировщик остановлен.");
  });

  it("второй процесс для той же базы завершается сообщением и кодом 1, первый продолжает работать", async () => {
    const first = startWorker();
    await vi.waitFor(() => expect(first.state.out).toContain("Планировщик запущен"), { timeout: 15_000 });
    const second = startWorker();
    child = first.process;
    expect(await second.exited).toBe(1);
    expect(second.state.err).toContain("Планировщик уже запущен для этой базы.");
    expect(second.state.out).not.toContain("Планировщик запущен");
    first.process.kill("SIGINT");
    expect(await first.exited).toBe(0);
  });
});
