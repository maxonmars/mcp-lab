import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { files, localPath, workspacePaths } from "./files.ts";

const WEATHER_SMOKE_TIMEOUT_MS = 5_000;
const SCHEDULER_SMOKE_TIMEOUT_MS = 10_000;
const OUTFIT_TOOLS = ["get_current_weather", "recommend_outfit", "save_outfit_advice"];
const PUBLIC_SCHEDULER_TOOLS = ["cancel_weather_schedule", "get_weather_summary", "schedule_weather"];

/** Собранный сервер планировщика из другого каталога: список инструментов, запись в SQLite, режим worker. */
async function schedulerSmoke(root: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), "mcp-lab-build-scheduler-"));
  const dbPath = join(temporary, "data", "scheduler.sqlite");
  const start = async (...flags: string[]) => {
    const client = new Client({ name: "build-smoke", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
    const args = [
      join(root, "servers/scheduler/dist/app/main.js"),
      "--db",
      dbPath,
      "--reports-dir",
      join(temporary, "reports"),
      ...flags,
    ];
    const transport = new StdioClientTransport({ command: process.execPath, args, cwd: temporary, stderr: "ignore" });
    await client.connect(transport, { timeout: SCHEDULER_SMOKE_TIMEOUT_MS });
    return client;
  };
  const publicClient = await start();
  const workerClient = await start("--worker");
  try {
    const listed = (await publicClient.listTools()).tools.map((tool) => tool.name).sort();
    if (listed.join() !== PUBLIC_SCHEDULER_TOOLS.join())
      throw new Error("Scheduler MCP server smoke: неверный список публичных инструментов.");
    const workerTools = (await workerClient.listTools()).tools.map((tool) => tool.name);
    if (workerTools.length === 0 || workerTools.some((name) => !name.startsWith("worker_"))) {
      throw new Error("Scheduler MCP server smoke: режим worker показывает не служебные инструменты.");
    }
    const arguments_ = { city: "Омск", collectEverySeconds: 10, summaryEverySeconds: 60 };
    const created = await publicClient.callTool(
      { name: "schedule_weather", arguments: arguments_ },
      { timeout: SCHEDULER_SMOKE_TIMEOUT_MS },
    );
    if (created.isError || !existsSync(dbPath))
      throw new Error("Scheduler MCP server smoke: расписание не записано в SQLite.");
  } finally {
    await publicClient.close();
    await workerClient.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
/** Собранный Open‑Meteo в outfit-режиме объявляет три инструмента; сеть и модель не вызываются. */
async function outfitSmoke(root: string, cwd: string): Promise<void> {
  const client = new Client({ name: "build-smoke", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "servers/open-meteo/dist/app/main.js"), "--outfit-report-file", join(cwd, "latest.md")],
    env: {
      LAB_LLM_API_KEY: "smoke",
      LAB_LLM_MODEL: "smoke",
      LAB_LLM_TIMEOUT_MS: "1000",
      LAB_LLM_MAX_OUTPUT_TOKENS: "1",
    },
    cwd,
    stderr: "ignore",
  });
  await client.connect(transport, { timeout: WEATHER_SMOKE_TIMEOUT_MS });
  try {
    const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
    if (listed.join() !== OUTFIT_TOOLS.join()) throw new Error("Open-Meteo MCP server smoke: неверный outfit-режим.");
  } finally {
    await client.close();
  }
}

const root = resolve(".");
for (const workspace of workspacePaths(root)) {
  rmSync(join(workspace, "dist"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "tsconfig.build.json")],
    { stdio: "inherit" },
  );
  for (const path of files(join(workspace, "src")).filter((path) => path.endsWith(".md"))) {
    const target = join(workspace, "dist", localPath(join(workspace, "src"), path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
  }
}
const temporary = mkdtempSync(join(tmpdir(), "mcp-lab-build-"));
try {
  for (const args of [["help"], ["config", "show"]]) {
    execFileSync(process.execPath, [join(root, "apps/host/dist/app/main.js"), ...args], {
      cwd: temporary,
      env: {},
      stdio: "pipe",
    });
  }
  const filesystemRoot = join(temporary, "filesystem");
  mkdirSync(filesystemRoot);
  const output = execFileSync(
    process.execPath,
    [join(root, "apps/host/dist/app/main.js"), "--mcp-filesystem-root", filesystemRoot, "mcp", "tools"],
    { cwd: temporary, encoding: "utf8", env: {}, stdio: "pipe" },
  );
  for (const name of ["read_text_file", "list_directory", "write_file"]) {
    if (!output.includes(name)) throw new Error(`В собранном выводе отсутствует ${name}.`);
  }
  console.log("Сборка и запуск CLI из другого каталога: OK.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const weatherTemporary = mkdtempSync(join(tmpdir(), "mcp-lab-build-weather-"));
try {
  const output = execFileSync(process.execPath, [join(root, "servers/open-meteo/dist/app/main.js")], {
    cwd: weatherTemporary,
    input: "",
    env: {},
    timeout: WEATHER_SMOKE_TIMEOUT_MS,
    encoding: "utf8",
  });
  if (output.trim()) throw new Error("Open-Meteo MCP server smoke: посторонний вывод в stdout.");
  await outfitSmoke(root, weatherTemporary);
  console.log("Запуск собранного Open-Meteo MCP server из другого каталога: OK.");
} finally {
  rmSync(weatherTemporary, { recursive: true, force: true });
}

await schedulerSmoke(root);
console.log("Запуск собранного Scheduler MCP server из другого каталога: OK.");
