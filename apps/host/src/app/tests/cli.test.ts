import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../core/index.ts";
import { run } from "../compose.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-cli-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function invoke(argv: string[], input = "", authenticated = true) {
  let output = "";
  let error = "";
  const complete = vi.fn(async (messages: readonly Message[]) => `Ответ: ${messages.at(-1)?.content}`);
  const createModel = vi.fn(() => ({ complete }));
  const code = await run({
    argv,
    cwd: root,
    env: authenticated ? { LAB_LLM_API_KEY: "test-key" } : {},
    createModel,
    terminal: {
      input: Readable.from([input]),
      interactive: false,
      output: new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        },
      }),
      error: new Writable({
        write(chunk, _encoding, done) {
          error += chunk.toString();
          done();
        },
      }),
    },
  });
  return { output, error, code, complete, createModel };
}

describe("CLI и REPL", () => {
  it("одинаково обрабатывают ask и /ask", async () => {
    const cli = await invoke(["ask", "Вопрос с пробелами"]);
    const repl = await invoke([], "/ask Вопрос с пробелами\n/exit\n");
    expect(cli.code).toBe(0);
    expect(repl.output).toBe(cli.output);
    expect(repl.complete.mock.calls).toEqual(cli.complete.mock.calls);
    expect(cli.complete.mock.calls[0]?.[0]?.[0]?.content).toContain("полезный собеседник");
  });

  it("справка и config show доступны без API-ключа и без создания модели", async () => {
    const help = await invoke(["--help"], "", false);
    const config = await invoke(["config", "show"], "", false);
    expect(help.output).toContain("--llm-model");
    expect(config.output).toContain("[не задано]");
    expect(help.createModel).not.toHaveBeenCalled();
    expect(config.createModel).not.toHaveBeenCalled();
  });

  it("продолжает REPL после неизвестной команды и останавливается на /exit", async () => {
    const result = await invoke([], "/unknown\nВопрос\n/exit\nПосле выхода\n");
    expect(result.code).toBe(1);
    expect(result.error).toContain("Неизвестная команда");
    expect(result.output).toBe("Ответ: Вопрос\n");
    expect(result.complete).toHaveBeenCalledTimes(1);
  });

  it("при отсутствии ключа возвращает ошибку и не вызывает модель", async () => {
    const result = await invoke(["ask", "Тест"], "", false);
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("отклоняет лишние и отсутствующие аргументы команд", async () => {
    expect((await invoke(["help", "extra"])).code).toBe(1);
    expect((await invoke(["ask"])).code).toBe(1);
  });
});
