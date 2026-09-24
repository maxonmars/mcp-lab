import { Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { CliView, type Command } from "../index.ts";

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", undefined);
  vi.stubEnv("NO_COLOR", undefined);
  vi.stubEnv("NODE_DISABLE_COLORS", undefined);
});

function capture(color = false) {
  const stream = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        stream.text += chunk.toString();
        done();
      },
    }),
    { text: "" },
  );
  if (color) Object.assign(stream, { isTTY: true, getColorDepth: () => 8 });
  return stream;
}

const commands: Command[] = [
  { name: "ask", arguments: ["<текст...>"], description: "Спросить.", run: async () => "continue" },
  { name: "help", arguments: [], aliases: ["--help", "-h"], description: "Справка.", run: async () => "continue" },
];

function renderAll(view: CliView): void {
  view.banner(commands);
  view.prompt();
  view.answer("Ответ модели");
  view.help(commands, [{ flag: "--llm-model", type: "string", description: "Модель." }]);
  view.config([{ key: "llm.apiKey", value: "[задано]", source: "env" }]);
  view.mcpTools({ server: { name: "fs", version: "1" }, tools: [{ name: "read", description: "Читает." }] });
  view.error(new AgentError("EMPTY_RESPONSE"));
}

it("обычный поток получает текст без ANSI, цветной — ту же структуру со стилями", () => {
  const plain = { output: capture(), error: capture() };
  const colored = { output: capture(true), error: capture(true) };
  renderAll(new CliView(plain.output, plain.error));
  renderAll(new CliView(colored.output, colored.error));
  expect(plain.output.text).not.toContain("\u001b[");
  expect(plain.error.text).toBe("Ошибка · Модель вернула пустой ответ.\n");
  expect(colored.output.text).toContain("\u001b[36m\u001b[1m── Ответ агента ──");
  expect(colored.output.text).toContain("\u001b[35mmcp-lab >\u001b[39m ");
  expect(colored.error.text).toContain("\u001b[31m\u001b[1mОшибка");
  expect(stripVTControlCharacters(colored.output.text)).toBe(plain.output.text);
  expect(stripVTControlCharacters(colored.error.text)).toBe(plain.error.text);
});

it("решает о цвете отдельно для stdout и stderr", () => {
  const output = capture(true);
  const error = capture();
  const view = new CliView(output, error);
  view.answer("Текст");
  view.error(new AgentError("EMPTY_INPUT"));
  expect(output.text).toContain("\u001b[");
  expect(error.text).toBe("Ошибка · Введите непустую реплику.\n");
  expect(output.text).not.toContain("Ошибка");
});

it("оформляет справку, настройки и ответ по визуальному контракту", () => {
  const output = capture();
  renderAll(new CliView(output, capture()));
  expect(output.text).toBe(
    [
      "── mcp-lab ──",
      "Команды: /ask · /help. Строка без / — вопрос агенту.",
      "",
      "mcp-lab > ",
      "── Ответ агента ──",
      "",
      "Ответ модели",
      "",
      "── Справка ──",
      "",
      "Команды",
      "  ask <текст...>  Спросить.",
      "  help            Справка.",
      "                  Алиасы: --help, -h.",
      "",
      "Настройки",
      "  --llm-model <string>  Модель.",
      "",
      "── Настройки ──",
      "",
      "llm.apiKey  [задано]  (env)",
      "",
      "── MCP · fs · 1 ──",
      "",
      "Инструментов: 1",
      "",
      "1. read",
      "   Читает.",
      "",
    ].join("\n"),
  );
});

it("не показывает текст неизвестной ошибки", () => {
  const error = capture();
  new CliView(capture(), error).error(new Error("sk-secret-value"));
  expect(error.text).toBe("Ошибка · Не удалось выполнить операцию.\n");
});

it("строка статуса MCP называет фактически вызванный инструмент, без аргументов и результата", () => {
  const output = capture();
  const view = new CliView(output, capture());
  view.mcpToolStatus("get_current_weather", true);
  view.mcpToolStatus("schedule_weather", true);
  view.mcpToolStatus("get_weather_summary", false);
  expect(output.text).toBe(
    [
      "MCP: get_current_weather — выполнено",
      "MCP: schedule_weather — выполнено",
      "MCP: get_weather_summary — ошибка",
      "",
    ].join("\n"),
  );
});

it("сводка и служебные сообщения worker: сводка и статус — в stdout, предупреждение — в stderr", () => {
  const output = capture();
  const error = capture();
  const view = new CliView(output, error);
  view.workerStarted("/data/scheduler.sqlite");
  view.report("Новосибирск", "---\ncity: Новосибирск\n---\n\nТекст.\n");
  view.workerStopped();
  view.warning("Копия .md не записана.");
  expect(output.text).toBe(
    [
      "Планировщик запущен, база: /data/scheduler.sqlite. Остановка — Ctrl+C.",
      "",
      "── Сводка · Новосибирск ──",
      "",
      "---",
      "city: Новосибирск",
      "---",
      "",
      "Текст.",
      "Планировщик остановлен.",
      "",
    ].join("\n"),
  );
  expect(error.text).toBe("Предупреждение · Копия .md не записана.\n");
});
