import { describe, expect, it, vi } from "vitest";
import { fetchCurrentWeather } from "../weather/forecast.ts";
import type { GeocodedPlace, WeatherDependencies } from "../weather/types.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(fetchImpl: typeof fetch): WeatherDependencies {
  return { fetchImpl, timeoutMs: 1000 };
}

const place: GeocodedPlace = {
  name: "Новосибирск",
  latitude: 55.03,
  longitude: 82.92,
  timezone: "Asia/Novosibirsk",
};

const validCurrent = {
  time: "2026-09-23T14:00",
  temperature_2m: 12.3,
  apparent_temperature: 10.1,
  relative_humidity_2m: 65,
  precipitation: 0,
  weather_code: 3,
  wind_speed_10m: 14.4,
};

describe("fetchCurrentWeather", () => {
  it("передаёт координаты и все переменные current, а также единицы измерения", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ current: validCurrent }));
    await fetchCurrentWeather(place, deps(fetchImpl));
    const [url] = fetchImpl.mock.calls[0] ?? [];
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(requested.searchParams.get("latitude")).toBe("55.03");
    expect(requested.searchParams.get("longitude")).toBe("82.92");
    expect(requested.searchParams.get("current")).toBe(
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    );
    expect(requested.searchParams.get("timezone")).toBe("auto");
    expect(requested.searchParams.get("temperature_unit")).toBe("celsius");
    expect(requested.searchParams.get("wind_speed_unit")).toBe("kmh");
    expect(requested.searchParams.get("precipitation_unit")).toBe("mm");
  });

  it("нормализует поля ответа", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ current: validCurrent }));
    await expect(fetchCurrentWeather(place, deps(fetchImpl))).resolves.toEqual({
      time: "2026-09-23T14:00",
      temperature: 12.3,
      apparentTemperature: 10.1,
      relativeHumidity: 65,
      precipitation: 0,
      weatherCode: 3,
      windSpeed: 14.4,
    });
  });

  it("сетевой сбой даёт WEATHER_NETWORK_FAILED", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(fetchCurrentWeather(place, deps(fetchImpl))).rejects.toMatchObject({
      code: "WEATHER_NETWORK_FAILED",
    });
  });

  it("не-2xx статус даёт WEATHER_BAD_STATUS", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: true }, 503));
    await expect(fetchCurrentWeather(place, deps(fetchImpl))).rejects.toMatchObject({ code: "WEATHER_BAD_STATUS" });
  });

  it("невалидный JSON даёт WEATHER_INVALID_PAYLOAD", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(fetchCurrentWeather(place, deps(fetchImpl))).rejects.toMatchObject({
      code: "WEATHER_INVALID_PAYLOAD",
    });
  });

  it("payload без current даёт WEATHER_INVALID_PAYLOAD", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    await expect(fetchCurrentWeather(place, deps(fetchImpl))).rejects.toMatchObject({
      code: "WEATHER_INVALID_PAYLOAD",
    });
  });
});
