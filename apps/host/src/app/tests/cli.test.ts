import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolSource } from "../../core/index.ts";
import {
  type FilesystemDiscoveryOptions,
  McpDiscoveryError,
  type McpDiscoveryResult,
  McpToolSourceError,
  type StdioToolSourceOptions,
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

function defaultComplete(request: ModelRequest): Promise<ModelCompletion> {
  return Promise.resolve({ type: "text", content: `Ответ: ${request.messages.at(-1)?.content}` });
}

const emptyToolSource: ToolSource = {
  listTools: async () => [],
  callTool: async () => {
    throw new Error("callTool не должен вызываться без объявленных инструментов");
  },
};

async function defaultWithWeatherToolSource(
  _options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<string>,
): Promise<string> {
  return use(emptyToolSource);
}

type CompleteMock = ReturnType<typeof vi.fn<(request: ModelRequest) => Promise<ModelCompletion>>>;
type WeatherToolSourceFn = (
  options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<string>,
) => Promise<string>;

type InvokeOptions = Readonly<{
  input?: string;
  authenticated?: boolean;
  discoverFilesystemTools?: (options: FilesystemDiscoveryOptions) => Promise<McpDiscoveryResult>;
  terminal?: { interactive?: boolean; color?: boolean };
  complete?: CompleteMock;
  withWeatherToolSource?: WeatherToolSourceFn;
}>;

async function invoke(argv: string[], opts: InvokeOptions = {}) {
  let output = "";
  let error = "";
  const complete = opts.complete ?? vi.fn(defaultComplete);
  const createModel = vi.fn(() => ({ complete }));
  const tty = opts.terminal?.color ? { isTTY: true, getColorDepth: () => 8 } : {};
  const code = await run({
    argv,
    cwd: root,
    env: opts.authenticated === false ? {} : { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: "node",
    createModel,
    discoverFilesystemTools: opts.discoverFilesystemTools,
    withWeatherToolSource: opts.withWeatherToolSource ?? defaultWithWeatherToolSource,
    withSchedulerToolSource: defaultWithWeatherToolSource,
    terminal: {
      input: Readable.from([opts.input ?? ""]),
      interactive: opts.terminal?.interactive ?? false,
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
    const repl = await invoke([], { input: "/ask Вопрос с пробелами\n/exit\n" });
    expect(cli.code).toBe(0);
    expect(repl.output).toBe(cli.output);
    expect(repl.complete.mock.calls).toEqual(cli.complete.mock.calls);
    const firstRequest = cli.complete.mock.calls[0]?.[0] as ModelRequest;
    expect(firstRequest.messages[0]?.content).toContain("полезный собеседник");
    expect(firstRequest.tools).toEqual([]);
    expect(firstRequest.toolChoice).toBe("none");
  });

  it("справка и config show доступны без API-ключа, модели и weather MCP", async () => {
    const discovery = vi.fn(async () => ({ server: { name: "filesystem", version: "1" }, tools: [] }));
    const weatherSpy = vi.fn(defaultWithWeatherToolSource);
    const help = await invoke(["--help"], {
      authenticated: false,
      discoverFilesystemTools: discovery,
      withWeatherToolSource: weatherSpy,
    });
    const config = await invoke(["config", "show"], {
      authenticated: false,
      discoverFilesystemTools: discovery,
      withWeatherToolSource: weatherSpy,
    });
    expect(help.output).toContain("--llm-model");
    expect(config.output).toContain("[не задано]");
    expect(help.createModel).not.toHaveBeenCalled();
    expect(config.createModel).not.toHaveBeenCalled();
    expect(discovery).not.toHaveBeenCalled();
    expect(weatherSpy).not.toHaveBeenCalled();
  });

  it("одинаково показывает инструменты Filesystem через CLI и REPL без модели и weather MCP", async () => {
    const response: McpDiscoveryResult = {
      server: { name: "filesystem", version: "1.0.0" },
      tools: [{ name: "zeta", description: "вторая строка\nописания" }, { name: "alpha" }],
    };
    const cliDiscovery = vi.fn(async () => response);
    const replDiscovery = vi.fn(async () => response);
    const weatherSpy = vi.fn(defaultWithWeatherToolSource);
    const cli = await invoke(["mcp", "tools"], {
      authenticated: false,
      discoverFilesystemTools: cliDiscovery,
      withWeatherToolSource: weatherSpy,
    });
    const repl = await invoke([], {
      input: "/mcp tools\n/exit\n",
      authenticated: false,
      discoverFilesystemTools: replDiscovery,
      withWeatherToolSource: weatherSpy,
    });
    expect(repl.output).toBe(cli.output);
    expect(cli.output).toBe(
      "\n── MCP · filesystem · 1.0.0 ──\n\nИнструментов: 2\n\n1. alpha\n\n2. zeta\n   вторая строка описания\n",
    );
    expect(cli.createModel).not.toHaveBeenCalled();
    expect(cliDiscovery).toHaveBeenCalledOnce();
    expect(replDiscovery).toHaveBeenCalledOnce();
    expect(weatherSpy).not.toHaveBeenCalled();
  });

  it("создаёт новое discovery при каждом вызове команды в REPL", async () => {
    const discovery = vi.fn(async () => ({ server: { name: "filesystem", version: "1" }, tools: [] }));
    const result = await invoke([], {
      input: "/mcp tools\n/mcp tools\n/exit\n",
      authenticated: false,
      discoverFilesystemTools: discovery,
    });
    expect(result.code).toBe(0);
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("продолжает REPL после ошибки discovery", async () => {
    const discovery = vi
      .fn()
      .mockRejectedValueOnce(new McpDiscoveryError("ROOT_NOT_FOUND"))
      .mockResolvedValueOnce({ server: { name: "filesystem", version: "1" }, tools: [] });
    const result = await invoke([], {
      input: "/mcp tools\n/mcp tools\n/exit\n",
      authenticated: false,
      discoverFilesystemTools: discovery,
    });
    expect(result.code).toBe(1);
    expect(result.error).toContain("Учебная папка MCP не существует");
    expect(result.output).toContain("Инструментов: 0");
    expect(discovery).toHaveBeenCalledTimes(2);
  });

  it("продолжает REPL после неизвестной команды и останавливается на /exit", async () => {
    const result = await invoke([], { input: "/unknown\nВопрос\n/exit\nПосле выхода\n" });
    expect(result.code).toBe(1);
    expect(result.error).toContain("Неизвестная команда");
    expect(result.output).toBe("\n── Ответ агента ──\n\nОтвет: Вопрос\n");
    expect(result.complete).toHaveBeenCalledTimes(1);
  });

  it("при отсутствии ключа возвращает ошибку, не вызывает модель и не запускает weather MCP", async () => {
    const weatherSpy = vi.fn(defaultWithWeatherToolSource);
    const result = await invoke(["ask", "Тест"], { authenticated: false, withWeatherToolSource: weatherSpy });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(result.createModel).not.toHaveBeenCalled();
    expect(weatherSpy).not.toHaveBeenCalled();
  });

  it("отклоняет лишние и отсутствующие аргументы команд", async () => {
    expect((await invoke(["help", "extra"])).code).toBe(1);
    expect((await invoke(["ask"])).code).toBe(1);
    expect((await invoke(["mcp", "tools", "extra"])).code).toBe(1);
  });

  it("интерактивный REPL показывает заголовок один раз и приглашение перед каждым вводом", async () => {
    const result = await invoke([], { input: "Вопрос\n/exit\n", terminal: { interactive: true } });
    expect(result.output.match(/── mcp-lab ──/g)).toHaveLength(1);
    expect(result.output).toContain(
      "/ask · /help · /config show · /mcp tools · /outfit · /scheduler run · /scheduler summary · /exit",
    );
    expect(result.output.match(/mcp-lab > /g)).toHaveLength(2);
    expect(result.output.indexOf("── mcp-lab ──")).toBeLessThan(result.output.indexOf("mcp-lab > "));
  });

  it("при pipe-вводе не печатает заголовок и приглашение", async () => {
    const result = await invoke([], { input: "/config show\n/exit\n" });
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
    const plain = await invoke([], { input: "Вопрос\n/mcp tools\n/exit\n", discoverFilesystemTools: discovery });
    const colored = await invoke([], {
      input: "Вопрос\n/mcp tools\n/boom\n",
      discoverFilesystemTools: discovery,
      terminal: { color: true },
    });
    expect(colored.output).toContain("\u001b[");
    expect(colored.error).toContain("\u001b[");
    expect(stripVTControlCharacters(colored.output)).toBe(plain.output);
    expect(colored.complete.mock.calls).toEqual(plain.complete.mock.calls);
    const firstRequest = colored.complete.mock.calls[0]?.[0] as ModelRequest;
    expect(firstRequest.messages.at(-1)?.content).toBe("Вопрос");
    expect(await discovery.mock.results[1]?.value).toEqual(response);
  });
});

describe("ask и Open-Meteo MCP tool calling", () => {
  const weatherTool = {
    name: "get_current_weather",
    description: "Текущая погода.",
    inputSchema: { type: "object", properties: { location: { type: "string" } } },
  };

  it("выполняет полный fake tool flow и печатает статус «выполнено» перед ответом", async () => {
    const callTool = vi.fn(async () => ({ content: "Ясно, 12°C", isError: false }));
    const toolSource: ToolSource = { listTools: async () => [weatherTool], callTool };
    const sessions: string[] = [];
    const withWeatherToolSource = vi.fn(
      async (_options: StdioToolSourceOptions, use: (source: ToolSource) => Promise<string>) => {
        sessions.push("open");
        try {
          return await use(toolSource);
        } finally {
          sessions.push("close");
        }
      },
    );
    const complete: CompleteMock = vi
      .fn<(request: ModelRequest) => Promise<ModelCompletion>>()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Новосибирск" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "В Новосибирске ясно, 12°C." });
    const result = await invoke(["ask", "Какая погода в Новосибирске?"], { complete, withWeatherToolSource });
    expect(result.code).toBe(0);
    expect(callTool).toHaveBeenCalledWith({ name: "get_current_weather", arguments: { location: "Новосибирск" } });
    expect(withWeatherToolSource).toHaveBeenCalledOnce();
    expect(sessions).toEqual(["open", "close"]);
    const statusIndex = result.output.indexOf("MCP: get_current_weather — выполнено");
    const answerIndex = result.output.indexOf("В Новосибирске ясно, 12°C.");
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(answerIndex);
  });

  it("tool isError печатает статус «ошибка» перед объяснением модели", async () => {
    const toolSource: ToolSource = {
      listTools: async () => [weatherTool],
      callTool: async () => ({ content: "Место не найдено.", isError: true }),
    };
    const withWeatherToolSource = (_options: StdioToolSourceOptions, use: (source: ToolSource) => Promise<string>) =>
      use(toolSource);
    const complete: CompleteMock = vi
      .fn<(request: ModelRequest) => Promise<ModelCompletion>>()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Незнакогород" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Не удалось получить данные о погоде." });
    const result = await invoke(["ask", "Погода в Незнакогороде?"], { complete, withWeatherToolSource });
    const statusIndex = result.output.indexOf("MCP: get_current_weather — ошибка");
    const answerIndex = result.output.indexOf("Не удалось получить данные о погоде.");
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(statusIndex).toBeLessThan(answerIndex);
  });

  it("прямой ответ модели без tool call не печатает статус MCP", async () => {
    const result = await invoke(["ask", "Просто вопрос"]);
    expect(result.output).not.toContain("MCP:");
  });

  it("каждая реплика REPL создаёт и закрывает отдельную weather MCP-сессию", async () => {
    const sessions: string[] = [];
    const withWeatherToolSource = vi.fn(
      async (_options: StdioToolSourceOptions, use: (source: ToolSource) => Promise<string>) => {
        sessions.push("open");
        try {
          return await use(emptyToolSource);
        } finally {
          sessions.push("close");
        }
      },
    );
    const result = await invoke([], { input: "Первый\nВторой\n/exit\n", withWeatherToolSource });
    expect(result.code).toBe(0);
    expect(withWeatherToolSource).toHaveBeenCalledTimes(2);
    expect(sessions).toEqual(["open", "close", "open", "close"]);
  });

  it("REPL продолжает работу после ошибки weather MCP-сессии", async () => {
    const withWeatherToolSource = vi
      .fn<WeatherToolSourceFn>()
      .mockRejectedValueOnce(new McpToolSourceError("CONNECT_FAILED"))
      .mockImplementationOnce(defaultWithWeatherToolSource);
    const result = await invoke([], { input: "Первый\nВторой\n/exit\n", withWeatherToolSource });
    expect(result.code).toBe(1);
    expect(result.error).toContain("MCP-сервером погоды");
    expect(result.output).toContain("Ответ: Второй");
    expect(withWeatherToolSource).toHaveBeenCalledTimes(2);
  });
});
