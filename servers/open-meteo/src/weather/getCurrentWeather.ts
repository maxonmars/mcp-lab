import { fetchCurrentWeather } from "./forecast.ts";
import { geocodeLocation } from "./geocode.ts";
import { buildSnapshot, type WeatherSnapshot } from "./snapshot.ts";
import type { WeatherDependencies } from "./types.ts";

export async function getCurrentWeather(location: string, deps: WeatherDependencies): Promise<WeatherSnapshot> {
  const place = await geocodeLocation(location, deps);
  const current = await fetchCurrentWeather(place, deps);
  return buildSnapshot(place, current);
}
