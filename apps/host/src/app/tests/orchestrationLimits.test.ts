import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import { READ_HOST_MANIFEST, SAVE_DEPENDENCY_REPORT } from "../../features/dependencies/index.ts";
import { run } from "../compose.ts";
import { createOrchestrationHarness, type OrchestrationHarness } from "./orchestrationHarness.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-orchestration-limits-"));
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

async function runAsk(
  complete: (request: ModelRequest) => Promise<ModelCompletion>,
  harness: OrchestrationHarness = createOrchestrationHarness(),
) {
  const term = terminal();
  const code = await run({
    argv: ["ask", "Проверь, стоит ли обновить Zod в apps/host/package.json, и сохрани короткий отчёт."],
    cwd: root,
    env: { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: process.execPath,
    terminal: term.io,
    createModel: () => ({ complete }),
    withWeatherToolSource: harness.withWeatherToolSource,
    withSchedulerToolSource: harness.withSchedulerToolSource,
    withFilesystemToolSource: harness.withFilesystemToolSource,
    withNpmToolSource: harness.withNpmToolSource,
    withGithubToolSource: harness.withGithubToolSource,
  });
  return { code, out: term.out(), err: term.err(), harness };
}

const statuses = (output: string) => output.split("\n").filter((line) => line.startsWith("MCP:"));

describe("orchestration: лимит вызовов и отказы", () => {
  it("модель, постоянно повторяющая вызов, останавливается на лимите ASK_MAX_TOOL_CALLS (6)", async () => {
    const requests: ModelRequest[] = [];
    const complete = async (request: ModelRequest): Promise<ModelCompletion> => {
      requests.push(request);
      return {
        type: "tool_calls",
        calls: [{ id: `call-${requests.length}`, name: "get_npm_package", arguments: { name: "zod" } }],
      };
    };
    const { code, out, err, harness } = await runAsk(complete);
    expect(code).toBe(1);
    expect(harness.log.filter((entry) => entry.name === "get_npm_package")).toHaveLength(6);
    expect(statuses(out)).toHaveLength(6);
    expect(requests).toHaveLength(7);
    expect(requests[6]?.toolChoice).toBe("none");
    expect(err).toContain("превысила лимит вызовов инструментов за реплику (6)");
  });

  it("несколько вызовов одного ответа выполняются по порядку", async () => {
    let round = 0;
    const complete = async (): Promise<ModelCompletion> => {
      round += 1;
      if (round === 1) {
        return {
          type: "tool_calls",
          calls: [
            { id: "call-1", name: READ_HOST_MANIFEST, arguments: {} },
            { id: "call-2", name: "get_npm_package", arguments: { name: "zod" } },
          ],
        };
      }
      return { type: "text", content: "Готово." };
    };
    const { code, harness } = await runAsk(complete);
    expect(code).toBe(0);
    expect(harness.log.map((entry) => entry.name)).toEqual(["read_text_file", "get_npm_package"]);
  });

  it("неизвестный инструмент среди нескольких вызовов отклоняется до выполнения", async () => {
    const complete = async (): Promise<ModelCompletion> => ({
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "get_npm_package", arguments: { name: "zod" } },
        { id: "call-2", name: "totally_unknown_tool", arguments: {} },
      ],
    });
    const { code, err, harness } = await runAsk(complete);
    expect(code).toBe(1);
    expect(err).toContain("неизвестный инструмент");
    expect(harness.log).toHaveLength(0);
  });

  it("isError GitHub (лимит без токена) доходит до модели текстом, реплика завершается ответом", async () => {
    const harness = createOrchestrationHarness({
      githubReply: () => ({
        content: "Исчерпан лимит запросов GitHub API без токена (60 в час); повторите позже.",
        isError: true,
      }),
    });
    let called = false;
    const complete = async (request: ModelRequest): Promise<ModelCompletion> => {
      if (!called) {
        called = true;
        return {
          type: "tool_calls",
          calls: [{ id: "call-1", name: "list_github_releases", arguments: { owner: "colinhacks", repo: "zod" } }],
        };
      }
      return { type: "text", content: `Не удалось получить релизы: ${request.messages.at(-1)?.content ?? ""}` };
    };
    const { code, out } = await runAsk(complete, harness);
    expect(code).toBe(0);
    expect(out).toContain("Исчерпан лимит запросов GitHub API");
  });

  it("save_dependency_report с некорректным packageName отклоняется без вызова write_file", async () => {
    let called = false;
    const complete = async (request: ModelRequest): Promise<ModelCompletion> => {
      if (!called) {
        called = true;
        return {
          type: "tool_calls",
          calls: [
            { id: "call-1", name: SAVE_DEPENDENCY_REPORT, arguments: { packageName: "../../etc", markdown: "# X" } },
          ],
        };
      }
      return { type: "text", content: request.messages.at(-1)?.content ?? "ответ" };
    };
    const { code, harness } = await runAsk(complete);
    expect(code).toBe(0);
    expect(harness.log.some((entry) => entry.name === "write_file")).toBe(false);
  });
});
