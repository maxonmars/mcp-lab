export type ScheduleRow = Readonly<{
  id: string;
  city: string;
  cityKey: string;
  collectEverySeconds: number;
  summaryEverySeconds: number;
  createdAtMs: number;
  nextCollectAtMs: number;
  nextSummaryAtMs: number;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  cancelledAtMs: number | null;
  lastSummaryError: string | null;
}>;

export type Observation = Readonly<{
  observedAtUtc: string;
  observedAtLocal: string;
  locationName: string;
  latitude: number;
  longitude: number;
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  windSpeed: number;
  condition: string;
}>;

export type PollResult = Readonly<{ ok: true; observation: Observation }> | Readonly<{ ok: false; error: string }>;

export type PollHistoryRow = Readonly<{
  requestedAtMs: number;
  ok: boolean;
  error?: string;
  observedAtUtc?: string;
  temperature?: number;
  condition?: string;
}>;

export type SummaryRow = Readonly<{
  id: number;
  scheduleId: string;
  publishedAtMs: number;
  periodStartMs: number;
  periodEndMs: number;
  uniqueObservations: number;
  markdown: string;
}>;
