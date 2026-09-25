import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolInvocation, ToolResult, ToolSource } from "../../core/index.ts";
import { McpToolSourceError, type StdioToolSourceOptions } from "../../features/mcp/index.ts";
import { run } from "../compose.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-outfit-"));
  vi.stubEnv("FORCE_COLOR", undefined);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const WEATHER_TEXT = "Погода в Омске: 5°C.\n- 2026-09-23T15:00: дождь.";
const ADVICE = "# Что надеть сейчас\n\nТёплая куртка и зонт.\n";
const tool = (name: string) => ({ name, inputSchema: { type: "object" } });
const openMeteoTools = ["get_current_weather", "recommend_outfit", "save_outfit_advice"].map(tool);

type Replies = Partial<Record<string, ToolResult | Error>>;

function weatherServer(replies: Replies = {}) {
  const defaults: Record<string, ToolResult> = {
    get_current_weather: { content: WEATHER_TEXT, isError: false },
    recommend_outfit: { content: ADVICE, isError: false },
    save_outfit_advice: { content: "Совет сохранён.", isError: false },
  };
  const callTool = vi.fn(async (invocation: ToolInvocation): Promise<ToolResult> => {
    const reply = replies[invocation.name] ?? defaults[invocation.name];
    if (reply instanceof Error) throw reply;
    return reply ?? { content: "неизвестно", isError: true };
  });
  const source: ToolSource = { listTools: async () => openMeteoTools, callTool };
  const sessions: StdioToolSourceOptions[] = [];
  const withWeatherToolSource = vi.fn(
    async (options: StdioToolSourceOptions, use: (source: ToolSource) => Promise<string>) => {
      sessions.push(options);
      return use(source);
    },
  );
  return { callTool, sessions, withWeatherToolSource };
}

const schedulerSource: ToolSource = {
  listTools: async () => [tool("schedule_weather")],
  callTool: async () => ({ content: "", isError: true }),
};

type InvokeOptions = Readonly<{
  input?: string;
  authenticated?: boolean;
  weather?: ReturnType<typeof weatherServer>;
  complete?: (request: ModelRequest) => Promise<ModelCompletion>;
}>;

async function invoke(argv: string[], opts: InvokeOptions = {}) {
  let output = "";
  let error = "";
  const sink = (append: (text: string) => void) =>
    new Writable({
      write(chunk, _encoding, done) {
        append(chunk.toString());
        done();
      },
    });
  const weather = opts.weather ?? weatherServer();
  const complete = vi.fn(opts.complete ?? (async () => ({ type: "text" as const, content: "Ответ" })));
  const createModel = vi.fn(() => ({ complete }));
  const code = await run({
    argv,
    cwd: root,
    env: opts.authenticated === false ? {} : { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: "node",
    createModel,
    withWeatherToolSource: weather.withWeatherToolSource,
    withSchedulerToolSource: (_options, use) => use(schedulerSource),
    terminal: {
      input: Readable.from([opts.input ?? ""]),
      interactive: false,
      output: sink((text) => {
        output += text;
      }),
      error: sink((text) => {
        error += text;
      }),
    },
  });
  return { output, error, code, weather, complete, createModel };
}

const statuses = (output: string) => output.split("\n").filter((line) => line.startsWith("MCP:"));

describe("команда outfit", () => {
  it("CLI и REPL одинаково выполняют три MCP-вызова в одной сессии и печатают совет с путём", async () => {
    const cli = await invoke(["outfit", "Нижний", "Новгород"]);
    const repl = await invoke([], { input: "/outfit Нижний Новгород\n/exit\n" });
    expect(cli.code).toBe(0);
    expect(repl.output).toBe(cli.output);
    expect(cli.weather.withWeatherToolSource).toHaveBeenCalledOnce();
    expect(cli.weather.callTool.mock.calls.map(([invocation]) => invocation)).toEqual([
      { name: "get_current_weather", arguments: { location: "Нижний Новгород", includeNextHours: true } },
      { name: "recommend_outfit", arguments: { weatherText: WEATHER_TEXT } },
      { name: "save_outfit_advice", arguments: { markdown: ADVICE } },
    ]);
    expect(statuses(cli.output)).toEqual([
      "MCP: get_current_weather — выполнено",
      "MCP: recommend_outfit — выполнено",
      "MCP: save_outfit_advice — выполнено",
    ]);
    const reportFile = join(root, ".local/outfit/latest.md");
    expect(cli.output).toContain("── Совет по одежде ──\n\n# Что надеть сейчас\n\nТёплая куртка и зонт.\n");
    expect(cli.output).toContain(`Сохранено: ${reportFile}`);
    expect(cli.output.indexOf("MCP: save_outfit_advice")).toBeLessThan(cli.output.indexOf("── Совет по одежде ──"));
    expect(cli.createModel).not.toHaveBeenCalled();
  });

  it("запускает Open-Meteo в outfit-режиме с путём от рабочего каталога и параметрами DeepSeek в env", async () => {
    const { weather } = await invoke(["outfit", "Омск"]);
    const [options] = weather.sessions;
    expect(options?.args.slice(1)).toEqual(["--outfit-report-file", join(root, ".local/outfit/latest.md")]);
    expect(options?.env).toEqual({
      LAB_LLM_API_KEY: "test-key",
      LAB_LLM_MODEL: "deepseek-flash",
      LAB_LLM_TIMEOUT_MS: "30000",
      LAB_LLM_MAX_OUTPUT_TOKENS: "1024",
    });
    expect(options?.timeoutMs).toBe(10_000);
    expect(options?.callTimeoutsMs).toEqual({ get_current_weather: 30_000, recommend_outfit: 40_000 });
  });

  it("ошибка погоды останавливает цепочку до совета и сохранения, код выхода 1", async () => {
    const weather = weatherServer({ get_current_weather: { content: "Место не найдено.", isError: true } });
    const result = await invoke(["outfit", "Атлантида"], { weather });
    expect(result.code).toBe(1);
    expect(result.error).toBe("Ошибка · Шаг «погода и прогноз» не выполнен: Место не найдено.\n");
    expect(statuses(result.output)).toEqual(["MCP: get_current_weather — ошибка"]);
    expect(weather.callTool).toHaveBeenCalledOnce();
  });

  it("ошибка транспорта называет шаг и причину MCP", async () => {
    const weather = weatherServer({ recommend_outfit: new McpToolSourceError("TIMEOUT", { stage: "callTool" }) });
    const result = await invoke(["outfit", "Омск"], { weather });
    expect(result.code).toBe(1);
    expect(result.error).toContain("Шаг «совет по одежде» не выполнен: Истёк таймаут MCP-сервера погоды");
    expect(statuses(result.output)).toEqual(["MCP: get_current_weather — выполнено", "MCP: recommend_outfit — ошибка"]);
  });

  it.each([
    [["outfit"], "Не указан город."],
    [["outfit", "О"], "Укажите город: от 2 до 100 символов."],
  ])("%j отклоняется до запуска MCP-сервера", async (argv, message) => {
    const result = await invoke(argv);
    expect(result.code).toBe(1);
    expect(result.error).toContain(message);
    expect(result.weather.withWeatherToolSource).not.toHaveBeenCalled();
  });

  it("без ключа не запускает MCP-сервер", async () => {
    const result = await invoke(["outfit", "Омск"], { authenticated: false });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(result.weather.withWeatherToolSource).not.toHaveBeenCalled();
  });
});

describe("ask и фасад prepare_outfit_advice", () => {
  function choosingFacade(location = "Новосибирск") {
    return vi
      .fn<(request: ModelRequest) => Promise<ModelCompletion>>()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "prepare_outfit_advice", arguments: { location } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "Наденьте тёплую куртку." });
  }

  it("Agent видит погоду, планировщик и фасад; статусы — три реальных MCP-вызова", async () => {
    const complete = choosingFacade();
    const result = await invoke(["ask", "Что надеть в Новосибирске, если выхожу на пару часов?"], { complete });
    expect(result.code).toBe(0);
    const first = complete.mock.calls[0]?.[0] as ModelRequest;
    expect(first.tools.map((item) => item.name)).toEqual([
      "get_current_weather",
      "prepare_outfit_advice",
      "schedule_weather",
    ]);
    expect(first.messages[0]?.content).toContain("посоветовать одежду");
    expect(result.weather.withWeatherToolSource).toHaveBeenCalledOnce();
    expect(statuses(result.output)).toEqual([
      "MCP: get_current_weather — выполнено",
      "MCP: recommend_outfit — выполнено",
      "MCP: save_outfit_advice — выполнено",
    ]);
    expect(result.output).not.toContain("prepare_outfit_advice");
    const toolMessage = complete.mock.calls[1]?.[0].messages.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", content: expect.stringContaining("Тёплая куртка и зонт.") });
    expect(toolMessage?.content).toContain(join(root, ".local/outfit/latest.md"));
    expect(result.output).toContain("Наденьте тёплую куртку.");
  });

  it("ошибка фасада уходит модели как текст ошибки, а ask завершается ответом модели", async () => {
    const weather = weatherServer({
      recommend_outfit: { content: "Модель DeepSeek вернула пустой ответ.", isError: true },
    });
    const complete = choosingFacade();
    const result = await invoke(["ask", "Что надеть в Новосибирске?"], { complete, weather });
    expect(result.code).toBe(0);
    const toolMessage = complete.mock.calls[1]?.[0].messages.at(-1);
    expect(toolMessage?.content).toBe("Шаг «совет по одежде» не выполнен: Модель DeepSeek вернула пустой ответ.");
    expect(weather.callTool).toHaveBeenCalledTimes(2);
    expect(statuses(result.output)).toEqual(["MCP: get_current_weather — выполнено", "MCP: recommend_outfit — ошибка"]);
  });

  it("прямой вопрос о погоде вызывает get_current_weather без пайплайна", async () => {
    const complete = vi
      .fn<(request: ModelRequest) => Promise<ModelCompletion>>()
      .mockResolvedValueOnce({
        type: "tool_calls",
        calls: [{ id: "call-1", name: "get_current_weather", arguments: { location: "Омск" } }],
      })
      .mockResolvedValueOnce({ type: "text", content: "В Омске 5°C." });
    const result = await invoke(["ask", "Какая погода в Омске?"], { complete });
    expect(statuses(result.output)).toEqual(["MCP: get_current_weather — выполнено"]);
    expect(result.weather.callTool).toHaveBeenCalledWith({
      name: "get_current_weather",
      arguments: { location: "Омск" },
    });
  });

  it("модель не может вызвать скрытый шаг напрямую", async () => {
    const complete = vi.fn<(request: ModelRequest) => Promise<ModelCompletion>>().mockResolvedValueOnce({
      type: "tool_calls",
      calls: [{ id: "call-1", name: "save_outfit_advice", arguments: { markdown: "подмена" } }],
    });
    const result = await invoke(["ask", "Сохрани это"], { complete });
    expect(result.code).toBe(1);
    expect(result.error).toContain("неизвестный инструмент");
    expect(result.weather.callTool).not.toHaveBeenCalled();
  });
});
