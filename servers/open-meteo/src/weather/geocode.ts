import { z } from "zod/v4";
import { WeatherApiError } from "./errors.ts";
import { fetchJson } from "./httpClient.ts";
import type { GeocodedPlace, WeatherDependencies } from "./types.ts";

const geocodingResultSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
});
const geocodingResponseSchema = z.object({ results: z.array(geocodingResultSchema).optional() });

export async function geocodeLocation(location: string, deps: WeatherDependencies): Promise<GeocodedPlace> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "ru");
  const payload = await fetchJson(url, deps.fetchImpl, deps.timeoutMs, "geocoding");
  const parsed = geocodingResponseSchema.safeParse(payload);
  if (!parsed.success) throw new WeatherApiError("GEOCODING_INVALID_PAYLOAD");
  const [first] = parsed.data.results ?? [];
  if (!first) throw new WeatherApiError("GEOCODING_NOT_FOUND");
  return {
    name: first.name,
    admin1: first.admin1,
    country: first.country,
    countryCode: first.country_code,
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone,
  };
}
