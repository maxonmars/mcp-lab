import { describe, expect, it, vi } from "vitest";
import { getCurrentWeather } from "../weather/getCurrentWeather.ts";
import { formatWeatherText } from "../weather/snapshot.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const epoch = (iso: string) => Date.parse(iso) / 1000;

const geocodingResult = {
  name: "Новосибирск",
  latitude: 55.03,
  longitude: 82.92,
  timezone: "Asia/Novosibirsk",
  country: "Россия",
  country_code: "RU",
  admin1: "Новосибирская область",
};

function current(time = "2026-09-23T14:15") {
  return {
    utc_offset_seconds: 25200,
    current: {
      time,
      temperature_2m: 12,
      apparent_temperature: 10,
      relative_humidity_2m: 65,
      precipitation: 0,
      weather_code: 3,
      wind_speed_10m: 14,
    },
  };
}

/** Пять отметок подряд с шагом в час, начиная с firstUtc. */
function hourly(firstUtc: string, overrides: Record<string, unknown> = {}) {
  const first = epoch(firstUtc);
  return {
    hourly: {
      time: [0, 1, 2, 3, 4].map((hour) => first + hour * 3600),
      temperature_2m: [11, 12, 13, 14, 15],
      apparent_temperature: [9, 10, 11, 12, 13],
      wind_speed_10m: [10, 11, 12, 13, 14],
      weather_code: [3, 61, 2, 0, 1],
      precipitation: [0, 0.4, 0, 0, 0],
      precipitation_probability: [5, 60, 20, 0, 0],
      ...overrides,
    },
  };
}

type Setup = Readonly<{ currentBody?: unknown; hourlyBody?: unknown; hourlyStatus?: number; hourlyFails?: boolean }>;

function fakeFetch(setup: Setup = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "geocoding-api.open-meteo.com") return jsonResponse({ results: [geocodingResult] });
    if (url.searchParams.has("current")) return jsonResponse(setup.currentBody ?? current());
    if (setup.hourlyFails) throw new Error("offline");
    return jsonResponse(setup.hourlyBody ?? hourly("2026-09-23T07:00:00Z"), setup.hourlyStatus ?? 200);
  });
}

function deps(fetchImpl: typeof fetch, nowIso = "2026-09-23T07:20:00Z") {
  return { fetchImpl, timeoutMs: 1000, now: () => Date.parse(nowIso) };
}

async function nextHours(setup: Setup, nowIso?: string) {
  const snapshot = await getCurrentWeather("Новосибирск", deps(fakeFetch(setup), nowIso), { includeNextHours: true });
  return snapshot.nextHours ?? [];
}

describe("getCurrentWeather без includeNextHours", () => {
  it("делает прежние два запроса и возвращает прежний снимок и текст", async () => {
    for (const options of [undefined, { includeNextHours: false }]) {
      const fetchImpl = fakeFetch();
      const snapshot = await getCurrentWeather("Новосибирск", deps(fetchImpl), options);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(snapshot).not.toHaveProperty("nextHours");
      expect(snapshot).toEqual({
        location: {
          name: "Новосибирск",
          admin1: "Новосибирская область",
          country: "Россия",
          countryCode: "RU",
          latitude: 55.03,
          longitude: 82.92,
          timezone: "Asia/Novosibirsk",
        },
        observedAt: "2026-09-23T14:15",
        observedAtUtc: "2026-09-23T07:15:00Z",
        condition: { code: 3, description: "пасмурно" },
        temperature: 12,
        apparentTemperature: 10,
        relativeHumidity: 65,
        precipitation: 0,
        windSpeed: 14,
        units: {
          temperature: "°C",
          apparentTemperature: "°C",
          relativeHumidity: "%",
          precipitation: "мм",
          windSpeed: "км/ч",
        },
      });
      expect(formatWeatherText(snapshot)).toBe(
        [
          "Погода в Новосибирск, Новосибирская область, Россия (наблюдение: 2026-09-23T14:15, часовой пояс Asia/Novosibirsk).",
          "Состояние: пасмурно.",
          "Температура: 12°C (ощущается как 10°C).",
          "Влажность: 65%.",
          "Осадки: 0 мм.",
          "Ветер: 14 км/ч.",
        ].join("\n"),
      );
    }
  });
});

describe("getCurrentWeather с includeNextHours", () => {
  it("делает отдельный hourly-запрос без повторного геокодирования", async () => {
    const fetchImpl = fakeFetch();
    await getCurrentWeather("Новосибирск", deps(fetchImpl), { includeNextHours: true });
    const urls = fetchImpl.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.hostname)).toEqual([
      "geocoding-api.open-meteo.com",
      "api.open-meteo.com",
      "api.open-meteo.com",
    ]);
    const hourlyUrl = urls[2] as URL;
    expect(hourlyUrl.searchParams.get("latitude")).toBe("55.03");
    expect(hourlyUrl.searchParams.get("forecast_hours")).toBe("5");
    expect(hourlyUrl.searchParams.get("timeformat")).toBe("unixtime");
    expect(hourlyUrl.searchParams.get("hourly")).toBe(
      "temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation,precipitation_probability",
    );
    expect(hourlyUrl.searchParams.has("current")).toBe(false);
  });

  it("посреди часа выбирает три следующие отметки и переносит значения", async () => {
    const hours = await nextHours({});
    expect(hours.map((hour) => hour.timeUtc)).toEqual([
      "2026-09-23T08:00:00Z",
      "2026-09-23T09:00:00Z",
      "2026-09-23T10:00:00Z",
    ]);
    expect(hours[0]).toEqual({
      time: "2026-09-23T15:00",
      timeUtc: "2026-09-23T08:00:00Z",
      condition: { code: 61, description: "небольшой дождь" },
      temperature: 12,
      apparentTemperature: 10,
      windSpeed: 11,
      precipitationLastHour: 0.4,
      precipitationProbabilityLastHour: 60,
    });
  });

  it("на границе часа не берёт отметку, равную текущему времени", async () => {
    const body = { currentBody: current("2026-09-23T15:00"), hourlyBody: hourly("2026-09-23T08:00:00Z") };
    const hours = await nextHours(body, "2026-09-23T08:00:00Z");
    expect(hours.map((hour) => hour.timeUtc)).toEqual([
      "2026-09-23T09:00:00Z",
      "2026-09-23T10:00:00Z",
      "2026-09-23T11:00:00Z",
    ]);
  });

  it("отбирает по более позднему из текущего времени и observedAtUtc", async () => {
    const hours = await nextHours({}, "2026-09-23T06:00:00Z");
    expect(hours[0]?.timeUtc).toBe("2026-09-23T08:00:00Z");
    const later = await nextHours({}, "2026-09-23T08:30:00Z");
    expect(later.map((hour) => hour.timeUtc)).toEqual([
      "2026-09-23T09:00:00Z",
      "2026-09-23T10:00:00Z",
      "2026-09-23T11:00:00Z",
    ]);
  });

  it("через полночь показывает местную дату и время города", async () => {
    const body = { currentBody: current("2026-09-23T23:30"), hourlyBody: hourly("2026-09-23T16:00:00Z") };
    const hours = await nextHours(body, "2026-09-23T16:31:00Z");
    expect(hours.map((hour) => hour.time)).toEqual(["2026-09-24T00:00", "2026-09-24T01:00", "2026-09-24T02:00"]);
  });

  it("без вероятности осадков не придумывает значение", async () => {
    const withoutSeries = hourly("2026-09-23T07:00:00Z");
    delete (withoutSeries.hourly as Record<string, unknown>).precipitation_probability;
    const missing = await nextHours({ hourlyBody: withoutSeries });
    expect(missing.every((hour) => !("precipitationProbabilityLastHour" in hour))).toBe(true);
    const nulls = await nextHours({
      hourlyBody: hourly("2026-09-23T07:00:00Z", { precipitation_probability: [5, null, 20, 0, 0] }),
    });
    expect(nulls[0]).not.toHaveProperty("precipitationProbabilityLastHour");
    expect(nulls[1]?.precipitationProbabilityLastHour).toBe(20);
  });

  it("текст различает момент отметки и час перед ней", async () => {
    const snapshot = await getCurrentWeather("Новосибирск", deps(fakeFetch()), { includeNextHours: true });
    const text = formatWeatherText(snapshot);
    expect(text).toContain("местное время, Asia/Novosibirsk");
    expect(text).toContain("температура и ветер — на момент отметки");
    expect(text).toContain("осадки и их вероятность — за час перед отметкой");
    expect(text).toContain(
      "- 2026-09-23T15:00: небольшой дождь; температура 12°C (ощущается как 10°C); ветер 11 км/ч; " +
        "осадки за час до отметки 0.4 мм, вероятность осадков за этот час: 60%.",
    );
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
  });

  it.each([
    ["массивы разной длины", { temperature_2m: [11, 12, 13] }],
    ["вероятность другой длины", { precipitation_probability: [1, 2] }],
    ["время не возрастает", { time: [epoch("2026-09-23T08:00:00Z"), epoch("2026-09-23T08:00:00Z"), 1, 2, 3] }],
    ["время не число", { time: ["2026-09-23T08:00", "x", "y", "z", "w"] }],
  ])("%s — FORECAST_INVALID_PAYLOAD", async (_name, overrides) => {
    await expect(nextHours({ hourlyBody: hourly("2026-09-23T07:00:00Z", overrides) })).rejects.toMatchObject({
      code: "FORECAST_INVALID_PAYLOAD",
    });
  });

  it("меньше трёх будущих отметок — FORECAST_INCOMPLETE", async () => {
    await expect(nextHours({}, "2026-09-23T09:30:00Z")).rejects.toMatchObject({ code: "FORECAST_INCOMPLETE" });
  });

  it("пропуск обязательного значения в выбранной отметке — FORECAST_INCOMPLETE, а не ноль", async () => {
    const body = hourly("2026-09-23T07:00:00Z", { wind_speed_10m: [10, 11, null, 13, 14] });
    await expect(nextHours({ hourlyBody: body })).rejects.toMatchObject({ code: "FORECAST_INCOMPLETE" });
  });

  it("пропуск значения за пределами трёх отметок не мешает", async () => {
    const body = hourly("2026-09-23T07:00:00Z", { temperature_2m: [null, 12, 13, 14, null] });
    await expect(nextHours({ hourlyBody: body })).resolves.toHaveLength(3);
  });

  it("сетевой сбой и не-2xx статус hourly-запроса называют стадию прогноза", async () => {
    await expect(nextHours({ hourlyFails: true })).rejects.toMatchObject({ code: "FORECAST_NETWORK_FAILED" });
    await expect(nextHours({ hourlyStatus: 503 })).rejects.toMatchObject({ code: "FORECAST_BAD_STATUS" });
    await expect(nextHours({ hourlyBody: { hourly: {} } })).rejects.toMatchObject({
      code: "FORECAST_INVALID_PAYLOAD",
    });
  });
});
