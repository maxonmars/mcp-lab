export type WeatherApiErrorCode =
  | "GEOCODING_NOT_FOUND"
  | "GEOCODING_NETWORK_FAILED"
  | "GEOCODING_BAD_STATUS"
  | "GEOCODING_INVALID_PAYLOAD"
  | "WEATHER_NETWORK_FAILED"
  | "WEATHER_BAD_STATUS"
  | "WEATHER_INVALID_PAYLOAD";

export class WeatherApiError extends Error {
  readonly code: WeatherApiErrorCode;

  constructor(code: WeatherApiErrorCode) {
    super(code);
    this.name = "WeatherApiError";
    this.code = code;
  }
}

const MESSAGES: Readonly<Record<WeatherApiErrorCode, string>> = {
  GEOCODING_NOT_FOUND: "Место не найдено сервисом геокодирования Open-Meteo.",
  GEOCODING_NETWORK_FAILED: "Не удалось обратиться к сервису геокодирования Open-Meteo.",
  GEOCODING_BAD_STATUS: "Сервис геокодирования Open-Meteo вернул ошибку.",
  GEOCODING_INVALID_PAYLOAD: "Сервис геокодирования Open-Meteo вернул некорректный ответ.",
  WEATHER_NETWORK_FAILED: "Не удалось обратиться к сервису текущей погоды Open-Meteo.",
  WEATHER_BAD_STATUS: "Сервис текущей погоды Open-Meteo вернул ошибку.",
  WEATHER_INVALID_PAYLOAD: "Сервис текущей погоды Open-Meteo вернул некорректный ответ.",
};

export function describeWeatherError(error: unknown): string {
  if (error instanceof WeatherApiError) return MESSAGES[error.code];
  return "Не удалось получить данные Open-Meteo.";
}
