import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerLock } from "../store/workerLock.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  harness?.cleanup();
});

function holdInChild(dbPath: string): Promise<{ child: ChildProcess; state: string }> {
  const fixture = new URL("./fixtures/holdLock.ts", import.meta.url);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", fixture.pathname, dbPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.once("data", (chunk) => resolve({ child, state: String(chunk).trim() }));
  });
}

describe("WorkerLock", () => {
  it("второй захват той же базы отклоняется, после release — разрешён", () => {
    harness = createHarness();
    const first = WorkerLock.acquire(harness.dbPath);
    expect(first).toBeDefined();
    expect(WorkerLock.acquire(harness.dbPath)).toBeUndefined();
    first?.release();
    const again = WorkerLock.acquire(harness.dbPath);
    expect(again).toBeDefined();
    again?.release();
  });

  it("разные записи одного пути делят блокировку, разные базы — независимы", () => {
    harness = createHarness();
    symlinkSync(join(harness.dir, "data"), join(harness.dir, "alias"));
    const first = WorkerLock.acquire(harness.dbPath);
    expect(WorkerLock.acquire(join(harness.dir, "alias", "scheduler.sqlite"))).toBeUndefined();
    mkdirSync(join(harness.dir, "other"));
    const other = WorkerLock.acquire(join(harness.dir, "other", "scheduler.sqlite"));
    expect(other).toBeDefined();
    first?.release();
    other?.release();
  });

  it("процесс держит блокировку, а после аварийного завершения (SIGKILL) она восстанавливается", async () => {
    harness = createHarness();
    const { child, state } = await holdInChild(harness.dbPath);
    expect(state).toBe("held");
    expect(WorkerLock.acquire(harness.dbPath)).toBeUndefined();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    const recovered = WorkerLock.acquire(harness.dbPath);
    expect(recovered).toBeDefined();
    recovered?.release();
  });

  it("блокировка, занятая другим процессом, не даёт захватить её и второму процессу", async () => {
    harness = createHarness();
    await holdInChild(harness.dbPath);
    const second = await holdInChild(harness.dbPath);
    expect(second.state).toBe("busy");
  });
});
