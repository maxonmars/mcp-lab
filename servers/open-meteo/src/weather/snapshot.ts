import { z } from "zod/v4";
import type { CurrentWeather, GeocodedPlace, HourlyForecast } from "./types.ts";
import { describeWeatherCode } from "./wmoCodes.ts";

const nextHourSchema = z.object({
  time: z.string(),
  timeUtc: z.string(),
  condition: z.object({ code: z.number(), description: z.string() }),
  temperature: z.number(),
  apparentTemperature: z.number(),
  windSpeed: z.number(),
  precipitationLastHour: z.number(),
  precipitationProbabilityLastHour: z.number().optional(),
});

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
  nextHours: z.array(nextHourSchema).optional(),
});

export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;

const UNITS = {
  temperature: "°C",
  apparentTemperature: "°C",
  relativeHumidity: "%",
  precipitation: "мм",
  windSpeed: "км/ч",
} as const;

export function buildSnapshot(
  place: GeocodedPlace,
  current: CurrentWeather,
  nextHours?: readonly HourlyForecast[],
): WeatherSnapshot {
  const snapshot: WeatherSnapshot = {
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
  return nextHours ? { ...snapshot, nextHours: nextHours.map(toNextHour) } : snapshot;
}

function toNextHour(hour: HourlyForecast): NonNullable<WeatherSnapshot["nextHours"]>[number] {
  return {
    time: hour.time,
    timeUtc: hour.timeUtc,
    condition: { code: hour.weatherCode, description: describeWeatherCode(hour.weatherCode) },
    temperature: hour.temperature,
    apparentTemperature: hour.apparentTemperature,
    windSpeed: hour.windSpeed,
    precipitationLastHour: hour.precipitationLastHour,
    ...(hour.precipitationProbabilityLastHour === undefined
      ? {}
      : { precipitationProbabilityLastHour: hour.precipitationProbabilityLastHour }),
  };
}

function nextHoursLines(snapshot: WeatherSnapshot): string[] {
  if (!snapshot.nextHours) return [];
  const units = snapshot.units;
  return [
    `Прогноз на ближайшие часы (местное время, ${snapshot.location.timezone}). Состояние, температура и ветер — на момент отметки; осадки и их вероятность — за час перед отметкой.`,
    ...snapshot.nextHours.map((hour) => {
      const probability =
        hour.precipitationProbabilityLastHour === undefined
          ? "нет данных"
          : `${hour.precipitationProbabilityLastHour}%`;
      return (
        `- ${hour.time}: ${hour.condition.description}; ` +
        `температура ${hour.temperature}${units.temperature} (ощущается как ${hour.apparentTemperature}${units.apparentTemperature}); ` +
        `ветер ${hour.windSpeed} ${units.windSpeed}; ` +
        `осадки за час до отметки ${hour.precipitationLastHour} ${units.precipitation}, вероятность осадков за этот час: ${probability}.`
      );
    }),
  ];
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
    ...nextHoursLines(snapshot),
  ].join("\n");
}
