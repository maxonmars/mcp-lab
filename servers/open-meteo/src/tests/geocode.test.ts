import { describe, expect, it, vi } from "vitest";
import { geocodeLocation } from "../weather/geocode.ts";
import type { WeatherDependencies } from "../weather/types.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(fetchImpl: typeof fetch): WeatherDependencies {
  return { fetchImpl, timeoutMs: 1000, now: () => 0 };
}

const validResult = {
  name: "Новосибирск",
  latitude: 55.03,
  longitude: 82.92,
  timezone: "Asia/Novosibirsk",
  country: "Россия",
  country_code: "RU",
  admin1: "Новосибирская область",
};

describe("geocodeLocation", () => {
  it("кодирует location и передаёт count/format/language", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: [validResult] }));
    await geocodeLocation("Новосибирск, Россия", deps(fetchImpl));
    const [url] = fetchImpl.mock.calls[0] ?? [];
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe("https://geocoding-api.open-meteo.com/v1/search");
    expect(requested.searchParams.get("name")).toBe("Новосибирск, Россия");
    expect(requested.searchParams.get("count")).toBe("1");
    expect(requested.searchParams.get("format")).toBe("json");
    expect(requested.searchParams.get("language")).toBe("ru");
  });

  it("использует первый результат и переносит все поля места", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ results: [validResult, { ...validResult, name: "Второй" }] }));
    await expect(geocodeLocation("Новосибирск", deps(fetchImpl))).resolves.toEqual({
      name: "Новосибирск",
      admin1: "Новосибирская область",
      country: "Россия",
      countryCode: "RU",
      latitude: 55.03,
      longitude: 82.92,
      timezone: "Asia/Novosibirsk",
    });
  });

  it("пустой список результатов даёт GEOCODING_NOT_FOUND", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: [] }));
    await expect(geocodeLocation("Несуществующий", deps(fetchImpl))).rejects.toMatchObject({
      code: "GEOCODING_NOT_FOUND",
    });
  });

  it("сетевой сбой даёт GEOCODING_NETWORK_FAILED", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(geocodeLocation("Новосибирск", deps(fetchImpl))).rejects.toMatchObject({
      code: "GEOCODING_NETWORK_FAILED",
    });
  });

  it("не-2xx статус даёт GEOCODING_BAD_STATUS", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: true }, 500));
    await expect(geocodeLocation("Новосибирск", deps(fetchImpl))).rejects.toMatchObject({
      code: "GEOCODING_BAD_STATUS",
    });
  });

  it("невалидный JSON даёт GEOCODING_INVALID_PAYLOAD", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(geocodeLocation("Новосибирск", deps(fetchImpl))).rejects.toMatchObject({
      code: "GEOCODING_INVALID_PAYLOAD",
    });
  });

  it("payload, не соответствующий схеме, даёт GEOCODING_INVALID_PAYLOAD", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ results: [{ name: "Без координат" }] }));
    await expect(geocodeLocation("Новосибирск", deps(fetchImpl))).rejects.toMatchObject({
      code: "GEOCODING_INVALID_PAYLOAD",
    });
  });
});
