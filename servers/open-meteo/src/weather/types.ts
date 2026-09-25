/** now — текущее время в миллисекундах UTC; нужно только для выбора будущих почасовых интервалов. */
export type WeatherDependencies = Readonly<{ fetchImpl: typeof fetch; timeoutMs: number; now: () => number }>;

export type GeocodedPlace = Readonly<{
  name: string;
  admin1?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}>;

export type CurrentWeather = Readonly<{
  time: string;
  timeUtc: string;
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
}>;

/** Температура, ветер и состояние — на момент отметки; осадки и их вероятность — за час перед ней. */
export type HourlyForecast = Readonly<{
  time: string;
  timeUtc: string;
  temperature: number;
  apparentTemperature: number;
  windSpeed: number;
  weatherCode: number;
  precipitationLastHour: number;
  precipitationProbabilityLastHour?: number;
}>;
