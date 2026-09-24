import { z } from "zod/v4";
import { WeatherApiError } from "./errors.ts";
import { fetchJson } from "./httpClient.ts";
import type { CurrentWeather, GeocodedPlace, WeatherDependencies } from "./types.ts";
import { toUtcTime } from "./utcTime.ts";

const currentSchema = z.object({
  time: z.string(),
  temperature_2m: z.number(),
  apparent_temperature: z.number(),
  relative_humidity_2m: z.number(),
  precipitation: z.number(),
  weather_code: z.number(),
  wind_speed_10m: z.number(),
});
const forecastResponseSchema = z.object({ utc_offset_seconds: z.number(), current: currentSchema });

const CURRENT_VARIABLES = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
] as const;

export async function fetchCurrentWeather(place: GeocodedPlace, deps: WeatherDependencies): Promise<CurrentWeather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("current", CURRENT_VARIABLES.join(","));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  const payload = await fetchJson(url, deps.fetchImpl, deps.timeoutMs, "weather");
  const parsed = forecastResponseSchema.safeParse(payload);
  if (!parsed.success) throw new WeatherApiError("WEATHER_INVALID_PAYLOAD");
  const { current, utc_offset_seconds: utcOffsetSeconds } = parsed.data;
  const timeUtc = toUtcTime(current.time, utcOffsetSeconds);
  if (!timeUtc) throw new WeatherApiError("WEATHER_INVALID_PAYLOAD");
  return {
    time: current.time,
    timeUtc,
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    relativeHumidity: current.relative_humidity_2m,
    precipitation: current.precipitation,
    weatherCode: current.weather_code,
    windSpeed: current.wind_speed_10m,
  };
}
