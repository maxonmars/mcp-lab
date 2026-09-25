import { WeatherApiError, type WeatherApiErrorCode } from "./errors.ts";

export type FetchStage = "geocoding" | "weather" | "forecast";

const NETWORK_ERRORS: Readonly<Record<FetchStage, WeatherApiErrorCode>> = {
  geocoding: "GEOCODING_NETWORK_FAILED",
  weather: "WEATHER_NETWORK_FAILED",
  forecast: "FORECAST_NETWORK_FAILED",
};
const STATUS_ERRORS: Readonly<Record<FetchStage, WeatherApiErrorCode>> = {
  geocoding: "GEOCODING_BAD_STATUS",
  weather: "WEATHER_BAD_STATUS",
  forecast: "FORECAST_BAD_STATUS",
};
const PAYLOAD_ERRORS: Readonly<Record<FetchStage, WeatherApiErrorCode>> = {
  geocoding: "GEOCODING_INVALID_PAYLOAD",
  weather: "WEATHER_INVALID_PAYLOAD",
  forecast: "FORECAST_INVALID_PAYLOAD",
};

export async function fetchJson(
  url: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  stage: FetchStage,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch {
    throw new WeatherApiError(NETWORK_ERRORS[stage]);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new WeatherApiError(STATUS_ERRORS[stage]);
  try {
    return await response.json();
  } catch {
    throw new WeatherApiError(PAYLOAD_ERRORS[stage]);
  }
}
