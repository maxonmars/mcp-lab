import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createWeatherServer, GET_CURRENT_WEATHER_TOOL_NAME } from "../index.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const geocodingResult = {
  name: "Новосибирск",
  latitude: 55.03,
  longitude: 82.92,
  timezone: "Asia/Novosibirsk",
  country: "Россия",
  country_code: "RU",
  admin1: "Новосибирская область",
};
const currentWeather = {
  time: "2026-09-23T14:00",
  temperature_2m: 12,
  apparent_temperature: 10,
  relative_humidity_2m: 65,
  precipitation: 0,
  weather_code: 3,
  wind_speed_10m: 14,
};

function fakeFetch(options: { geocodingResults?: unknown[]; geocodingStatus?: number } = {}): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.hostname === "geocoding-api.open-meteo.com") {
      return jsonResponse({ results: options.geocodingResults ?? [geocodingResult] }, options.geocodingStatus ?? 200);
    }
    return jsonResponse({ utc_offset_seconds: 25200, current: currentWeather });
  }) as typeof fetch;
}

let client: Client | undefined;
let handle: StdioServerHandle | undefined;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
});

/** serveStdio (а не McpServer.connect напрямую) — единственное место, где сервер понимает modern-probe. */
async function connectedClient(fetchImpl: typeof fetch): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createWeatherServer({ fetchImpl, timeoutMs: 1000 }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

describe("Open-Meteo MCP server: протокольная интеграция", () => {
  it("согласует современную ревизию и объявляет tools capability", async () => {
    const created = await connectedClient(fakeFetch());
    expect(created.getProtocolEra()).toBe("modern");
    expect(created.getServerCapabilities()?.tools).toBeTruthy();
  });

  it("listTools возвращает get_current_weather с описанием и полной input/output схемой", async () => {
    const created = await connectedClient(fakeFetch());
    const { tools } = await created.listTools();
    const tool = tools.find((item) => item.name === GET_CURRENT_WEATHER_TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("текущую погоду");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: { location: expect.objectContaining({ type: "string" }) },
      required: ["location"],
    });
    expect(tool?.outputSchema).toMatchObject({ type: "object" });
  });

  it("отклоняет короткий location через MCP schema validation", async () => {
    const created = await connectedClient(fakeFetch());
    const result = await created.callTool({ name: GET_CURRENT_WEATHER_TOOL_NAME, arguments: { location: "Н" } });
    expect(result.isError).toBe(true);
  });

  it("успешный вызов возвращает text и structuredContent", async () => {
    const created = await connectedClient(fakeFetch());
    const result = await created.callTool({
      name: GET_CURRENT_WEATHER_TOOL_NAME,
      arguments: { location: "Новосибирск" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Новосибирск") }]);
    expect(result.structuredContent).toMatchObject({
      location: { name: "Новосибирск" },
      observedAt: "2026-09-23T14:00",
      observedAtUtc: "2026-09-23T07:00:00Z",
      temperature: 12,
    });
  });

  it("город не найден возвращает isError без обращения к forecast", async () => {
    const created = await connectedClient(fakeFetch({ geocodingResults: [] }));
    const result = await created.callTool({
      name: GET_CURRENT_WEATHER_TOOL_NAME,
      arguments: { location: "Атлантида" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("не найдено") }]);
  });
});
