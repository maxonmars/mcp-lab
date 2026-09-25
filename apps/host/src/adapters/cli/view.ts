import type { Writable } from "node:stream";
import type { McpDiscoveryResult } from "../../features/mcp/index.ts";
import type { Command } from "./commands.ts";
import { describeError } from "./errors.ts";
import { mcpToolLines, wrapText } from "./mcp.ts";
import { type Paint, painter } from "./paint.ts";

export type HelpSetting = Readonly<{ flag: string; type: string; description: string }>;
export type ConfigRow = Readonly<{ key: string; value: string; source: string }>;
export type CommandView = Pick<CliView, "answer" | "help" | "config" | "mcpTools" | "outfitAdvice" | "report">;

const fallbackWidth = 88;
const columnGap = "  ";

type Row = Readonly<{ label: string; plain: string; text: string; note?: string | undefined }>;

export class CliView {
  readonly #output: Writable;
  readonly #error: Writable;
  readonly #paint: Paint;

  constructor(output: Writable, error: Writable) {
    this.#output = output;
    this.#error = error;
    this.#paint = painter(output);
  }

  answer(text: string): void {
    this.#block("Ответ агента", [text]);
  }

  help(commands: readonly Command[], settings: readonly HelpSetting[]): void {
    const paint = this.#paint;
    const commandRows = commands.map((command) => ({
      label: [paint("key", command.name), ...command.arguments].join(" "),
      plain: [command.name, ...command.arguments].join(" "),
      text: command.description,
      note: command.aliases?.length ? `Алиасы: ${command.aliases.join(", ")}.` : undefined,
    }));
    const settingRows = settings.map((setting) => ({
      label: `${paint("key", setting.flag)} ${paint("muted", `<${setting.type}>`)}`,
      plain: `${setting.flag} <${setting.type}>`,
      text: setting.description,
    }));
    this.#block("Справка", [
      paint("key", "Команды"),
      ...this.#table(commandRows),
      "",
      paint("key", "Настройки"),
      ...this.#table(settingRows),
    ]);
  }

  config(rows: readonly ConfigRow[]): void {
    const paint = this.#paint;
    const keyWidth = Math.max(...rows.map((row) => row.key.length));
    const valueWidth = Math.max(...rows.map((row) => row.value.length));
    this.#block(
      "Настройки",
      rows.map((row) => {
        const key = paint("key", row.key) + " ".repeat(keyWidth - row.key.length);
        const value = row.value.padEnd(valueWidth);
        return `${key}${columnGap}${value}${columnGap}${paint("muted", `(${row.source})`)}`;
      }),
    );
  }

  mcpTools(result: McpDiscoveryResult): void {
    this.#block(
      `MCP · ${result.server.name} · ${result.server.version}`,
      mcpToolLines(result, this.#width(), this.#paint),
    );
  }

  /** Одна служебная строка перед финальным ответом; аргументы и содержимое результата не печатаются. */
  mcpToolStatus(toolName: string, succeeded: boolean): void {
    const outcome = succeeded ? "выполнено" : "ошибка";
    this.#output.write(`${this.#paint("muted", `MCP: ${toolName} — ${outcome}`)}\n`);
  }

  outfitAdvice(markdown: string, path: string): void {
    this.#block("Совет по одежде", [markdown.trimEnd(), "", this.#paint("muted", `Сохранено: ${path}`)]);
  }

  /** Опубликованная сводка планировщика: в терминале worker и в `scheduler summary`. */
  report(city: string, markdown: string): void {
    this.#block(`Сводка · ${city}`, [markdown.trimEnd()]);
  }

  workerStarted(dbPath: string): void {
    this.#output.write(`${this.#paint("muted", `Планировщик запущен, база: ${dbPath}. Остановка — Ctrl+C.`)}\n`);
  }

  workerStopped(): void {
    this.#output.write(`${this.#paint("muted", "Планировщик остановлен.")}\n`);
  }

  /** Предупреждение, не прерывающее работу: пишется в stderr. */
  warning(text: string): void {
    const paint = painter(this.#error);
    this.#error.write(`${paint("errorLabel", "Предупреждение")}${paint("error", ` · ${text}`)}\n`);
  }

  error(error: unknown): void {
    const paint = painter(this.#error);
    this.#error.write(`${paint("errorLabel", "Ошибка")}${paint("error", ` · ${describeError(error)}`)}\n`);
  }

  banner(commands: readonly Command[]): void {
    const hint = `Команды: ${commands.map((command) => `/${command.name}`).join(" · ")}. Строка без / — вопрос агенту.`;
    this.#output.write(`${this.#paint("heading", "── mcp-lab ──")}\n${this.#paint("muted", hint)}\n`);
  }

  prompt(): void {
    this.#output.write(`\n${this.#paint("prompt", "mcp-lab >")} `);
  }

  #width(): number {
    const columns = (this.#output as Partial<Record<"columns", unknown>>).columns;
    return typeof columns === "number" && columns > 0 ? columns : fallbackWidth;
  }

  #table(rows: readonly Row[]): string[] {
    const labelWidth = Math.max(...rows.map((row) => row.plain.length));
    const indent = " ".repeat(2 + labelWidth + columnGap.length);
    const textWidth = Math.max(this.#width() - indent.length, 20);
    return rows.flatMap((row) => {
      const [first = "", ...rest] = wrapText(row.text, textWidth);
      const label = `  ${row.label}${" ".repeat(labelWidth - row.plain.length)}`;
      const notes = row.note ? wrapText(row.note, textWidth).map((line) => this.#paint("muted", line)) : [];
      return [`${label}${columnGap}${first}`, ...[...rest, ...notes].map((line) => `${indent}${line}`)];
    });
  }

  /** Блок начинается с пустой строки, чтобы в REPL отделяться от введённой реплики. */
  #block(title: string, lines: readonly string[]): void {
    const body = lines.join("\n");
    this.#output.write(`\n${this.#paint("heading", `── ${title} ──`)}\n\n${body.endsWith("\n") ? body : `${body}\n`}`);
  }
}
