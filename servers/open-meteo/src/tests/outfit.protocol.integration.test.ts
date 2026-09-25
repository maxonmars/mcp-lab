import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWeatherServer,
  GET_CURRENT_WEATHER_TOOL_NAME,
  type GenerateAdvice,
  RECOMMEND_OUTFIT_TOOL_NAME,
  SAVE_OUTFIT_ADVICE_TOOL_NAME,
} from "../index.ts";
import { AdviceModelError } from "../outfit/deepseek.ts";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const nowMs = Date.parse("2026-09-23T07:20:00Z");
const firstHour = Date.parse("2026-09-23T07:00:00Z") / 1000;

const fakeFetch = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "geocoding-api.open-meteo.com") {
    return jsonResponse({
      results: [{ name: "Новосибирск", latitude: 55.03, longitude: 82.92, timezone: "Asia/Novosibirsk" }],
    });
  }
  if (url.searchParams.has("current")) {
    return jsonResponse({
      utc_offset_seconds: 25200,
      current: {
        time: "2026-09-23T14:15",
        temperature_2m: 12,
        apparent_temperature: 10,
        relative_humidity_2m: 65,
        precipitation: 0,
        weather_code: 3,
        wind_speed_10m: 14,
      },
    });
  }
  return jsonResponse({
    hourly: {
      time: [0, 1, 2, 3, 4].map((hour) => firstHour + hour * 3600),
      temperature_2m: [11, 12, 13, 14, 15],
      apparent_temperature: [9, 10, 11, 12, 13],
      wind_speed_10m: [10, 11, 12, 13, 14],
      weather_code: [3, 61, 2, 0, 1],
      precipitation: [0, 0.4, 0, 0, 0],
    },
  });
});

let root: string;
let reportFile: string;
let client: Client | undefined;
let handle: StdioServerHandle | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-outfit-server-"));
  reportFile = join(root, "outfit", "latest.md");
  fakeFetch.mockClear();
});

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function connect(generateAdvice: GenerateAdvice, file = reportFile): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const deps = { fetchImpl: fakeFetch, timeoutMs: 1000, now: () => nowMs };
  handle = serveStdio(() => createWeatherServer(deps, { generateAdvice, reportFile: file }), {
    transport: serverTransport,
  });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [block] = result.content as { type: string; text: string }[];
  return block?.text ?? "";
}

describe("Open-Meteo MCP server: outfit-режим", () => {
  it("объявляет ровно три инструмента со схемами входа и выхода", async () => {
    const created = await connect(async () => "совет");
    const { tools } = await created.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      GET_CURRENT_WEATHER_TOOL_NAME,
      RECOMMEND_OUTFIT_TOOL_NAME,
      SAVE_OUTFIT_ADVICE_TOOL_NAME,
    ]);
    const recommend = tools.find((tool) => tool.name === RECOMMEND_OUTFIT_TOOL_NAME);
    const save = tools.find((tool) => tool.name === SAVE_OUTFIT_ADVICE_TOOL_NAME);
    expect(recommend?.inputSchema).toMatchObject({ required: ["weatherText"] });
    expect(recommend?.outputSchema).toMatchObject({ properties: { markdown: { type: "string" } } });
    expect(save?.inputSchema).toMatchObject({ required: ["markdown"] });
    expect(save?.inputSchema.properties).not.toHaveProperty("path");
    expect(save?.outputSchema).toMatchObject({ properties: { path: { type: "string" } } });
  });

  it("цепочка погода → совет → сохранение передаёт тексты дословно и пишет точный файл", async () => {
    const generateAdvice = vi.fn<GenerateAdvice>(async () => "**Одежда** — куртка.\n");
    const created = await connect(generateAdvice);
    const weather = await created.callTool({
      name: GET_CURRENT_WEATHER_TOOL_NAME,
      arguments: { location: "Новосибирск", includeNextHours: true },
    });
    const weatherText = textOf(weather);
    expect(weatherText).toContain("за час до отметки");
    expect(weather.structuredContent).toMatchObject({ nextHours: [{ time: "2026-09-23T15:00" }, {}, {}] });

    const advice = await created.callTool({ name: RECOMMEND_OUTFIT_TOOL_NAME, arguments: { weatherText } });
    expect(generateAdvice).toHaveBeenCalledOnce();
    const request = generateAdvice.mock.calls[0]?.[0];
    expect(request?.weatherText).toBe(weatherText);
    expect(request?.instructions).toContain("вероятностный");
    expect(request?.instructions).toContain("переносимость холода неизвестна");
    const markdown = textOf(advice);
    expect(markdown).toBe(
      `# Что надеть сейчас\n\n**Одежда** — куртка.\n\n## Данные о погоде, на которых основан совет\n\n${weatherText}\n`,
    );
    expect(advice.structuredContent).toEqual({ markdown });

    const saved = await created.callTool({ name: SAVE_OUTFIT_ADVICE_TOOL_NAME, arguments: { markdown } });
    expect(saved.isError).not.toBe(true);
    expect(saved.structuredContent).toEqual({ path: reportFile });
    expect(readFileSync(reportFile, "utf8")).toBe(markdown);
  });

  it("повторное сохранение заменяет прежний совет и не оставляет временных файлов", async () => {
    const created = await connect(async () => "совет");
    await created.callTool({ name: SAVE_OUTFIT_ADVICE_TOOL_NAME, arguments: { markdown: "# Первый\n" } });
    await created.callTool({ name: SAVE_OUTFIT_ADVICE_TOOL_NAME, arguments: { markdown: "# Второй\n" } });
    expect(readFileSync(reportFile, "utf8")).toBe("# Второй\n");
    expect(readdirSync(join(root, "outfit"))).toEqual(["latest.md"]);
  });

  it("отказ записи — isError и нет временного файла рядом с целью", async () => {
    const target = join(root, "busy");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "x");
    const created = await connect(async () => "совет", target);
    const result = await created.callTool({ name: SAVE_OUTFIT_ADVICE_TOOL_NAME, arguments: { markdown: "# Совет\n" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Не удалось сохранить совет по одежде в файл.");
    expect(readdirSync(root)).toEqual(["busy"]);
  });

  it("каталог создаётся только при сохранении", async () => {
    const created = await connect(async () => "совет");
    await created.listTools();
    expect(readdirSync(root)).toEqual([]);
  });

  it.each([
    [new AdviceModelError("INCOMPLETE_RESPONSE"), "не завершила ответ"],
    [new AdviceModelError("EMPTY_RESPONSE"), "пустой ответ"],
    [new AdviceModelError("MODEL_FAILURE", 401), "HTTP 401"],
    [new Error("secret provider body"), "Не удалось получить совет модели."],
  ])("ошибка модели %s — isError с безопасной причиной", async (error, expected) => {
    const created = await connect(async () => {
      throw error;
    });
    const result = await created.callTool({ name: RECOMMEND_OUTFIT_TOOL_NAME, arguments: { weatherText: "Погода" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(expected);
    expect(textOf(result)).not.toContain("secret");
  });

  it("пустой weatherText или markdown отклоняется схемой", async () => {
    const generateAdvice = vi.fn<GenerateAdvice>(async () => "совет");
    const created = await connect(generateAdvice);
    const advice = await created.callTool({ name: RECOMMEND_OUTFIT_TOOL_NAME, arguments: { weatherText: "  " } });
    const saved = await created.callTool({ name: SAVE_OUTFIT_ADVICE_TOOL_NAME, arguments: { markdown: "" } });
    expect(advice.isError).toBe(true);
    expect(saved.isError).toBe(true);
    expect(generateAdvice).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual([]);
  });
});
