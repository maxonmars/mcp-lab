export type WeatherDependencies = Readonly<{ fetchImpl: typeof fetch; timeoutMs: number }>;

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
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
}>;
