import { describe, expect, it } from "vitest";
import { buildSnapshot, formatWeatherText, weatherSnapshotSchema } from "../weather/snapshot.ts";
import type { CurrentWeather, GeocodedPlace } from "../weather/types.ts";

const place: GeocodedPlace = {
  name: "Новосибирск",
  admin1: "Новосибирская область",
  country: "Россия",
  countryCode: "RU",
  latitude: 55.03,
  longitude: 82.92,
  timezone: "Asia/Novosibirsk",
};

const current: CurrentWeather = {
  time: "2026-09-23T14:00",
  timeUtc: "2026-09-23T07:00:00Z",
  temperature: 12,
  apparentTemperature: 10,
  relativeHumidity: 65,
  precipitation: 0,
  weatherCode: 3,
  windSpeed: 14,
};

describe("buildSnapshot", () => {
  it("собирает снимок, соответствующий output schema, и сохраняет единицы", () => {
    const snapshot = buildSnapshot(place, current);
    expect(weatherSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.units).toEqual({
      temperature: "°C",
      apparentTemperature: "°C",
      relativeHumidity: "%",
      precipitation: "мм",
      windSpeed: "км/ч",
    });
    expect(snapshot.condition).toEqual({ code: 3, description: "пасмурно" });
    expect(snapshot.location.timezone).toBe("Asia/Novosibirsk");
    expect(snapshot.observedAt).toBe("2026-09-23T14:00");
    expect(snapshot.observedAtUtc).toBe("2026-09-23T07:00:00Z");
  });
});

describe("formatWeatherText", () => {
  it("включает место, время, состояние, температуру, влажность, осадки, ветер и единицы", () => {
    const text = formatWeatherText(buildSnapshot(place, current));
    expect(text).toContain("Новосибирск, Новосибирская область, Россия");
    expect(text).toContain("2026-09-23T14:00");
    expect(text).toContain("Asia/Novosibirsk");
    expect(text).toContain("пасмурно");
    expect(text).toContain("12°C");
    expect(text).toContain("ощущается как 10°C");
    expect(text).toContain("65%");
    expect(text).toContain("0 мм");
    expect(text).toContain("14 км/ч");
  });
});
