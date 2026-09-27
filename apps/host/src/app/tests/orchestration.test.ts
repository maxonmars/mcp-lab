import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { run } from "../compose.ts";
import { resolveHostManifest } from "../serverEntrypoints.ts";
import {
  createOrchestrationHarness,
  MANIFEST_TEXT,
  NPM_TEXT,
  orchestrationModel,
  RELEASE_TEXT,
  RELEASES_TEXT,
} from "./orchestrationHarness.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-orchestration-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function terminal() {
  let output = "";
  let error = "";
  const sink = (append: (text: string) => void) =>
    new Writable({
      write(chunk, _encoding, done) {
        append(chunk.toString());
        done();
      },
    });
  return {
    io: {
      input: Readable.from([""]),
      interactive: false,
      output: sink((text) => (output += text)),
      error: sink((text) => (error += text)),
    },
    out: () => output,
    err: () => error,
  };
}

async function askOrchestration(question: string) {
  const harness = createOrchestrationHarness();
  const requests: ModelRequest[] = [];
  const term = terminal();
  const code = await run({
    argv: ["ask", question],
    cwd: root,
    env: { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: process.execPath,
    terminal: term.io,
    createModel: () => ({
      complete: async (request) => {
        requests.push(request);
        return orchestrationModel.complete(request);
      },
    }),
    withWeatherToolSource: harness.withWeatherToolSource,
    withSchedulerToolSource: harness.withSchedulerToolSource,
    withFilesystemToolSource: harness.withFilesystemToolSource,
    withNpmToolSource: harness.withNpmToolSource,
    withGithubToolSource: harness.withGithubToolSource,
  });
  return { code, out: term.out(), err: term.err(), harness, requests };
}

const statuses = (output: string) => output.split("\n").filter((line) => line.startsWith("MCP:"));
const QUESTION = "Проверь, стоит ли обновить Zod в apps/host/package.json, и сохрани короткий отчёт.";

describe("orchestration: проверка обновления npm-зависимости", () => {
  it("выполняет пять MCP-вызовов по порядку через три сервера и печатает пять статусов до ответа", async () => {
    const { code, out, harness } = await askOrchestration(QUESTION);
    expect(code).toBe(0);
    expect(harness.log.map(({ server, name }) => ({ server, name }))).toEqual([
      { server: "filesystem", name: "read_text_file" },
      { server: "npm-registry", name: "get_npm_package" },
      { server: "github-releases", name: "list_github_releases" },
      { server: "github-releases", name: "get_github_release" },
      { server: "filesystem", name: "write_file" },
    ]);
    expect(harness.log[0]?.arguments).toEqual({ path: resolveHostManifest() });
    expect(harness.log[1]?.arguments).toEqual({ name: "zod" });
    expect(harness.log[2]?.arguments).toEqual({ owner: "colinhacks", repo: "zod" });
    expect(harness.log[3]?.arguments).toEqual({ owner: "colinhacks", repo: "zod", tag: "v4.6.5" });
    const saveArgs = harness.log[4]?.arguments as { path: string; content: string };
    expect(saveArgs.path).toBe(join(root, ".local/reports/dependency-zod.md"));
    expect(saveArgs.content).toContain("4.5.4");
    expect(saveArgs.content).toContain("4.6.5");
    const statusLines = statuses(out);
    expect(statusLines).toEqual([
      "MCP: filesystem › read_text_file — выполнено",
      "MCP: npm-registry › get_npm_package — выполнено",
      "MCP: github-releases › list_github_releases — выполнено",
      "MCP: github-releases › get_github_release — выполнено",
      "MCP: filesystem › write_file — выполнено",
    ]);
    const lastStatus = out.lastIndexOf(statusLines.at(-1) as string);
    expect(lastStatus).toBeLessThan(out.indexOf("── Ответ агента ──"));
    expect(harness.log.some((entry) => entry.server === "open-meteo" || entry.server === "scheduler")).toBe(false);
  });

  it("модель видит фасады, но не сырые инструменты Filesystem", async () => {
    const { requests } = await askOrchestration(QUESTION);
    const names = requests[0]?.tools.map((item) => item.name) ?? [];
    for (const visible of [
      "read_host_manifest",
      "save_dependency_report",
      "get_npm_package",
      "list_github_releases",
      "get_github_release",
    ]) {
      expect(names).toContain(visible);
    }
    for (const hidden of ["read_text_file", "write_file", "move_file"]) expect(names).not.toContain(hidden);
  });

  it("каждый запрос, кроме финального, просит модель tool_calls через toolChoice auto", async () => {
    const { requests } = await askOrchestration(QUESTION);
    expect(requests).toHaveLength(6);
    for (const request of requests.slice(0, 5)) expect(request.toolChoice).toBe("auto");
  });

  it("tool-сообщение каждого раунда дословно содержит результат соответствующего сервера", async () => {
    const { requests } = await askOrchestration(QUESTION);
    expect(requests[1]?.messages.at(-1)?.content).toBe(MANIFEST_TEXT);
    expect(requests[2]?.messages.at(-1)?.content).toBe(NPM_TEXT);
    expect(requests[3]?.messages.at(-1)?.content).toBe(RELEASES_TEXT);
    expect(requests[4]?.messages.at(-1)?.content).toBe(RELEASE_TEXT);
    expect(requests[5]?.messages.at(-1)?.content).toContain("Отчёт сохранён в файл");
  });

  it("опции сессий несут serverName; filesystem получает каталог host и .local/reports", async () => {
    const { harness } = await askOrchestration(QUESTION);
    expect(harness.openMeteoSessions[0]?.serverName).toBe("open-meteo");
    expect(harness.schedulerSessions[0]?.serverName).toBe("scheduler");
    expect(harness.npmSessions[0]?.serverName).toBe("npm-registry");
    expect(harness.githubSessions[0]?.serverName).toBe("github-releases");
    const fsOptions = harness.filesystemSessions[0];
    expect(fsOptions?.serverName).toBe("filesystem");
    expect(fsOptions?.args[1]).toBe(dirname(resolveHostManifest()));
    expect(fsOptions?.args[2]).toBe(join(root, ".local/reports"));
    expect(harness.reportsDirExistedAtOpen[0]).toBe(true);
  });

  it("нерелевантный вопрос вызывает только open-meteo и печатает одну строку MCP", async () => {
    const { code, out, harness } = await askOrchestration("Какая погода в Омске?");
    expect(code).toBe(0);
    expect(harness.log).toEqual([{ server: "open-meteo", name: "get_current_weather", arguments: expect.any(Object) }]);
    expect(statuses(out)).toEqual(["MCP: open-meteo › get_current_weather — выполнено"]);
  });
});
