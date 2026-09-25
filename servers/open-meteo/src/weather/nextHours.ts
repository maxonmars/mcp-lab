import { z } from "zod/v4";
import { WeatherApiError } from "./errors.ts";
import { fetchJson } from "./httpClient.ts";
import type { GeocodedPlace, HourlyForecast, WeatherDependencies } from "./types.ts";

export const NEXT_HOURS_COUNT = 3;
/** Первая отметка ответа — начало текущего часа, поэтому запас в две отметки. */
const FORECAST_HOURS = 5;

const HOURLY_VARIABLES = [
  "temperature_2m",
  "apparent_temperature",
  "wind_speed_10m",
  "weather_code",
  "precipitation",
  "precipitation_probability",
] as const;

const values = z.array(z.number().nullable());
const hourlySchema = z.object({
  time: z.array(z.number().int()),
  temperature_2m: values,
  apparent_temperature: values,
  wind_speed_10m: values,
  weather_code: values,
  precipitation: values,
  precipitation_probability: values.optional(),
});
const hourlyResponseSchema = z.object({ hourly: hourlySchema });
type Hourly = z.infer<typeof hourlySchema>;

function requireConsistent(hourly: Hourly): void {
  const length = hourly.time.length;
  const series = [
    hourly.temperature_2m,
    hourly.apparent_temperature,
    hourly.wind_speed_10m,
    hourly.weather_code,
    hourly.precipitation,
    ...(hourly.precipitation_probability ? [hourly.precipitation_probability] : []),
  ];
  if (series.some((items) => items.length !== length)) throw new WeatherApiError("FORECAST_INVALID_PAYLOAD");
  if (hourly.time.some((time, index) => index > 0 && time <= (hourly.time[index - 1] ?? time))) {
    throw new WeatherApiError("FORECAST_INVALID_PAYLOAD");
  }
}

function utcText(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}

/** Местное время `YYYY-MM-DDTHH:MM` в часовом поясе найденного места, как у `observedAt`. */
export function localTime(epochSeconds: number, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(epochSeconds * 1000));
  } catch {
    throw new WeatherApiError("GEOCODING_INVALID_PAYLOAD");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function required(value: number | null | undefined): number {
  if (value === null || value === undefined) throw new WeatherApiError("FORECAST_INCOMPLETE");
  return value;
}

function toForecast(hourly: Hourly, index: number, timeZone: string): HourlyForecast {
  const epochSeconds = hourly.time[index] ?? 0;
  const probability = hourly.precipitation_probability?.[index];
  return {
    time: localTime(epochSeconds, timeZone),
    timeUtc: utcText(epochSeconds),
    temperature: required(hourly.temperature_2m[index]),
    apparentTemperature: required(hourly.apparent_temperature[index]),
    windSpeed: required(hourly.wind_speed_10m[index]),
    weatherCode: required(hourly.weather_code[index]),
    precipitationLastHour: required(hourly.precipitation[index]),
    ...(probability === null || probability === undefined ? {} : { precipitationProbabilityLastHour: probability }),
  };
}

/** Три первые отметки строго позже текущего времени и `observedAtUtc`; сравнение — в UTC. */
export async function fetchNextHours(
  place: GeocodedPlace,
  observedAtUtc: string,
  deps: WeatherDependencies,
): Promise<HourlyForecast[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("hourly", HOURLY_VARIABLES.join(","));
  url.searchParams.set("forecast_hours", String(FORECAST_HOURS));
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  const payload = await fetchJson(url, deps.fetchImpl, deps.timeoutMs, "forecast");
  const parsed = hourlyResponseSchema.safeParse(payload);
  if (!parsed.success) throw new WeatherApiError("FORECAST_INVALID_PAYLOAD");
  const hourly = parsed.data.hourly;
  requireConsistent(hourly);
  const observedAtMs = Date.parse(observedAtUtc);
  if (Number.isNaN(observedAtMs)) throw new WeatherApiError("WEATHER_INVALID_PAYLOAD");
  const afterMs = Math.max(deps.now(), observedAtMs);
  const indexes = hourly.time
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time * 1000 > afterMs)
    .slice(0, NEXT_HOURS_COUNT)
    .map(({ index }) => index);
  if (indexes.length < NEXT_HOURS_COUNT) throw new WeatherApiError("FORECAST_INCOMPLETE");
  return indexes.map((index) => toForecast(hourly, index, place.timezone));
}
