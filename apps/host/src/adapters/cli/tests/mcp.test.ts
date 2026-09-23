import { Writable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
import type { McpDiscoveryResult } from "../../../features/mcp/index.ts";
import { CliView } from "../index.ts";

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", undefined);
});

function render(result: McpDiscoveryResult, columns?: number): string {
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  if (columns) Object.assign(output, { columns });
  new CliView(output, new Writable()).mcpTools(result);
  return text;
}

const server = { name: "filesystem", version: "1.0.0" };

it("нумерует инструменты по алфавиту и не добавляет строку описания без текста", () => {
  const output = render({
    server,
    tools: [
      { name: "zeta", description: "Первая\n\tвторая" },
      { name: "alpha", description: "  " },
      { name: "middle" },
    ],
  });
  expect(output).toBe(
    [
      "",
      "── MCP · filesystem · 1.0.0 ──",
      "",
      "Инструментов: 3",
      "",
      "1. alpha",
      "",
      "2. middle",
      "",
      "3. zeta",
      "   Первая вторая",
      "",
    ].join("\n"),
  );
});

it("переносит длинное многострочное описание по ширине output без обрезки", () => {
  const description = "Читает файл\nцеликом и возвращает   содержимое как текст.\n\nПодходит для больших файлов.";
  const tools = [{ name: "read_text_file", description }];
  const output = render({ server, tools }, 30);
  const lines = output.split("\n").filter((line) => line.startsWith("   "));
  expect(lines.every((line) => line.length <= 30)).toBe(true);
  expect(lines.map((line) => line.trim()).join(" ")).toBe(description.replaceAll(/\s+/g, " "));
  expect(tools[0]?.description).toBe(description);
});

it("без известной ширины переносит по фиксированной ширине около 88 колонок", () => {
  const output = render({ server, tools: [{ name: "long", description: "слово ".repeat(40) }] });
  const lines = output.split("\n").filter((line) => line.startsWith("   "));
  expect(lines.length).toBeGreaterThan(1);
  expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(88);
  expect(Math.max(...lines.map((line) => line.length))).toBeGreaterThan(80);
});

it("не печатает пустые блоки для нуля инструментов", () => {
  expect(render({ server, tools: [] })).toBe("\n── MCP · filesystem · 1.0.0 ──\n\nИнструментов: 0\n");
});
