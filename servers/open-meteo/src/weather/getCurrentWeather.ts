import { fetchCurrentWeather } from "./forecast.ts";
import { geocodeLocation } from "./geocode.ts";
import { fetchNextHours } from "./nextHours.ts";
import { buildSnapshot, type WeatherSnapshot } from "./snapshot.ts";
import type { WeatherDependencies } from "./types.ts";

export type CurrentWeatherOptions = Readonly<{ includeNextHours?: boolean | undefined }>;

export async function getCurrentWeather(
  location: string,
  deps: WeatherDependencies,
  options: CurrentWeatherOptions = {},
): Promise<WeatherSnapshot> {
  const place = await geocodeLocation(location, deps);
  const current = await fetchCurrentWeather(place, deps);
  if (!options.includeNextHours) return buildSnapshot(place, current);
  return buildSnapshot(place, current, await fetchNextHours(place, current.timeUtc, deps));
}
