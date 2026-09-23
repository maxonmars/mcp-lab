import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../core/index.ts";
import {
  type FilesystemDiscoveryOptions,
  McpDiscoveryError,
  type McpDiscoveryResult,
} from "../../features/mcp/index.ts";
import { run } from "../compose.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-cli-"));
  vi.stubEnv("FORCE_COLOR", undefined);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function invoke(
  argv: string[],
  input = "",
  authenticated = true,
  discoverFilesystemTools?: (options: FilesystemDiscoveryOptions) => Promise<McpDiscoveryResult>,
  terminal: { interactive?: boolean; color?: boolean } = {},
) {
  let output = "";
  let error = "";
  const complete = vi.fn(async (messages: readonly Message[]) => `Ответ: ${messages.at(-1)?.content}`);
  const createModel = vi.fn(() => ({ complete }));
  const tty = terminal.color ? { isTTY: true, getColorDepth: () => 8 } : {};
  const code = await run({
    argv,
    cwd: root,
    env: authenticated ? { LAB_LLM_API_KEY: "test-key" } : {},
    nodeExecutable: "node",
    createModel,
    discoverFilesystemTools,
    terminal: {
      input: Readable.from([input]),
      interactive: terminal.interactive ?? false,
      output: Object.assign(
        new Writable({
          write(chunk, _encoding, done) {
            output += chunk.toString();
            done();
          },
        }),
        tty,
      ),
      error: Object.assign(
        new Writable({
          write(chunk, _encoding, done) {
            error += chunk.toString();
            done();
          },
        }),
        tty,
      ),
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
    const discovery = vi.fn(async () => ({ server: { name: "filesystem", version: "1" }, tools: [] }));
    const help = await invoke(["--help"], "", false, discovery);
    const config = await invoke(["config", "show"], "", false, discovery);
    expect(help.output).toContain("--llm-model");
    expect(config.output).toContain("[не задано]");
    expect(help.createModel).not.toHaveBeenCalled();
    expect(config.createModel).not.toHaveBeenCalled();
    expect(discovery).not.toHaveBeenCalled();
  });

  it("одинаково показывает инструменты через CLI и REPL без создания модели", async () => {
    const response: McpDiscoveryResult = {
      server: { name: "filesystem", version: "1.0.0" },
      tools: [{ name: "zeta", description: "вторая строка\nописания" }, { name: "alpha" }],
    };
    const cliDiscovery = vi.fn(async () => response);
    const replDiscovery = vi.fn(async () => response);
    const cli = await invoke(["mcp", "tools"], "", false, cliDiscovery);
    const repl = await invoke([], "/mcp tools\n/exit\n", false, replDiscovery);
    expect(repl.output).toBe(cli.output);
    expect(cli.output).toBe(
      "\n── MCP · filesystem · 1.0.0 ──\n\nИнструментов: 2\n\n1. alpha\n\n2. zeta\n   вторая строка описания\n",
    );
    expect(response.tools[0]?.description).toBe("вторая строка\nописания");
    expect(cli.createModel).not.toHaveBeenCalled();
    expect(cliDiscovery).toHaveBeenCalledOnce();
    expect(replDiscovery).toHaveBeenCalledOnce();
  });

  it("создаёт новое discovery при каждом вызове команды в REPL", async () => {
    const discovery = vi.fn(async () => ({ server: { name: "filesystem", version: "1" }, tools: [] }));
    const result = await invoke([], "/mcp tools\n/mcp tools\n/exit\n", false, discovery);
    expect(result.code).toBe(0);
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("продолжает REPL после ошибки discovery", async () => {
    const discovery = vi
      .fn()
      .mockRejectedValueOnce(new McpDiscoveryError("ROOT_NOT_FOUND"))
      .mockResolvedValueOnce({ server: { name: "filesystem", version: "1" }, tools: [] });
    const result = await invoke([], "/mcp tools\n/mcp tools\n/exit\n", false, discovery);
    expect(result.code).toBe(1);
    expect(result.error).toContain("Учебная папка MCP не существует");
    expect(result.output).toContain("Инструментов: 0");
    expect(discovery).toHaveBeenCalledTimes(2);
  });

  it("продолжает REPL после неизвестной команды и останавливается на /exit", async () => {
    const result = await invoke([], "/unknown\nВопрос\n/exit\nПосле выхода\n");
    expect(result.code).toBe(1);
    expect(result.error).toContain("Неизвестная команда");
    expect(result.output).toBe("\n── Ответ агента ──\n\nОтвет: Вопрос\n");
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
    expect((await invoke(["mcp", "tools", "extra"])).code).toBe(1);
  });

  it("интерактивный REPL показывает заголовок один раз и приглашение перед каждым вводом", async () => {
    const result = await invoke([], "Вопрос\n/exit\n", true, undefined, { interactive: true });
    expect(result.output.match(/── mcp-lab ──/g)).toHaveLength(1);
    expect(result.output).toContain("/ask · /help · /config show · /mcp tools · /exit");
    expect(result.output.match(/mcp-lab > /g)).toHaveLength(2);
    expect(result.output.indexOf("── mcp-lab ──")).toBeLessThan(result.output.indexOf("mcp-lab > "));
  });

  it("при pipe-вводе не печатает заголовок и приглашение", async () => {
    const result = await invoke([], "/config show\n/exit\n");
    expect(result.output).not.toContain("mcp-lab");
    expect(result.output.startsWith("\n── Настройки ──")).toBe(true);
  });

  it("оформляет ошибку разбора аргументов так же, как ошибку команды", async () => {
    const parse = await invoke(["--unknown", "x", "help"]);
    const command = await invoke(["unknown"]);
    expect(parse.code).toBe(1);
    expect(parse.output).toBe("");
    expect(parse.error).toBe("Ошибка · Неизвестный или недоступный флаг. Используйте help.\n");
    expect(command.error).toBe("Ошибка · Неизвестная команда. Используйте help.\n");
  });

  it("справка разделена на команды и настройки без секретного флага", async () => {
    const { output } = await invoke(["help"]);
    expect(output.indexOf("\nКоманды\n")).toBeLessThan(output.indexOf("\nНастройки\n"));
    expect(output).toContain("  ask <текст...>");
    expect(output).toContain("Алиасы: --help, -h.");
    expect(output).toMatch(/--mcp-timeout-ms <number>\s+\S/);
    expect(output).not.toContain("--llm-api-key");
  });

  it("config show не выводит значение ключа", async () => {
    const { output } = await invoke(["config", "show"]);
    expect(output).toMatch(/llm\.apiKey\s+\[задано\]\s+\(env\)/);
    expect(output).not.toContain("test-key");
  });

  it("цвет не попадает в данные Agent и MCP", async () => {
    const response: McpDiscoveryResult = { server: { name: "filesystem", version: "1" }, tools: [{ name: "read" }] };
    const discovery = vi.fn(async () => structuredClone(response));
    const plain = await invoke([], "Вопрос\n/mcp tools\n/exit\n", true, discovery);
    const colored = await invoke([], "Вопрос\n/mcp tools\n/boom\n", true, discovery, { color: true });
    expect(colored.output).toContain("\u001b[");
    expect(colored.error).toContain("\u001b[");
    expect(stripVTControlCharacters(colored.output)).toBe(plain.output);
    expect(colored.complete.mock.calls).toEqual(plain.complete.mock.calls);
    expect(colored.complete.mock.calls[0]?.[0]?.at(-1)?.content).toBe("Вопрос");
    expect(await discovery.mock.results[1]?.value).toEqual(response);
  });
});
