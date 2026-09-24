import { z } from "zod/v4";
import type { CurrentWeather, GeocodedPlace } from "./types.ts";
import { describeWeatherCode } from "./wmoCodes.ts";

export const weatherSnapshotSchema = z.object({
  location: z.object({
    name: z.string(),
    admin1: z.string().optional(),
    country: z.string().optional(),
    countryCode: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
  }),
  observedAt: z.string(),
  observedAtUtc: z.string(),
  condition: z.object({ code: z.number(), description: z.string() }),
  temperature: z.number(),
  apparentTemperature: z.number(),
  relativeHumidity: z.number(),
  precipitation: z.number(),
  windSpeed: z.number(),
  units: z.object({
    temperature: z.string(),
    apparentTemperature: z.string(),
    relativeHumidity: z.string(),
    precipitation: z.string(),
    windSpeed: z.string(),
  }),
});

export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;

const UNITS = {
  temperature: "°C",
  apparentTemperature: "°C",
  relativeHumidity: "%",
  precipitation: "мм",
  windSpeed: "км/ч",
} as const;

export function buildSnapshot(place: GeocodedPlace, current: CurrentWeather): WeatherSnapshot {
  return {
    location: {
      name: place.name,
      admin1: place.admin1,
      country: place.country,
      countryCode: place.countryCode,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone,
    },
    observedAt: current.time,
    observedAtUtc: current.timeUtc,
    condition: { code: current.weatherCode, description: describeWeatherCode(current.weatherCode) },
    temperature: current.temperature,
    apparentTemperature: current.apparentTemperature,
    relativeHumidity: current.relativeHumidity,
    precipitation: current.precipitation,
    windSpeed: current.windSpeed,
    units: UNITS,
  };
}

export function formatWeatherText(snapshot: WeatherSnapshot): string {
  const place = [snapshot.location.name, snapshot.location.admin1, snapshot.location.country]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const units = snapshot.units;
  return [
    `Погода в ${place} (наблюдение: ${snapshot.observedAt}, часовой пояс ${snapshot.location.timezone}).`,
    `Состояние: ${snapshot.condition.description}.`,
    `Температура: ${snapshot.temperature}${units.temperature} (ощущается как ${snapshot.apparentTemperature}${units.apparentTemperature}).`,
    `Влажность: ${snapshot.relativeHumidity}${units.relativeHumidity}.`,
    `Осадки: ${snapshot.precipitation} ${units.precipitation}.`,
    `Ветер: ${snapshot.windSpeed} ${units.windSpeed}.`,
  ].join("\n");
}
