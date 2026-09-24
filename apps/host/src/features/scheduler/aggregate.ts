import type { PollRecord } from "./contracts.ts";

export type UniqueObservation = Readonly<{ observedAtUtc: string; temperature: number; condition: string }>;

export type TemperatureStats = Readonly<{
  first: number;
  last: number;
  change: number;
  min: number;
  max: number;
  mean: number;
}>;

export type Aggregate = Readonly<{
  periodStartMs: number;
  periodEndMs: number;
  requests: number;
  succeeded: number;
  failed: number;
  /** По одному наблюдению на слот `observedAtUtc` — последнему полученному ответу, по возрастанию времени. */
  observations: readonly UniqueObservation[];
  temperature: TemperatureStats | undefined;
  errors: readonly Readonly<{ reason: string; count: number }>[];
}>;

function isObservation(
  record: PollRecord,
): record is PollRecord & Required<Pick<PollRecord, "observedAtUtc" | "temperature">> {
  return record.ok && record.observedAtUtc !== undefined && record.temperature !== undefined;
}

function temperatureStats(observations: readonly UniqueObservation[]): TemperatureStats | undefined {
  const [first, ...rest] = observations;
  if (!first) return undefined;
  const values = observations.map((item) => item.temperature);
  const last = rest.at(-1) ?? first;
  return {
    first: first.temperature,
    last: last.temperature,
    change: last.temperature - first.temperature,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

/** Запросы считаются все; температура — только по уникальным слотам, чтобы повторы не искажали среднее. */
export function aggregate(records: readonly PollRecord[], periodStartMs: number, periodEndMs: number): Aggregate {
  const slots = new Map<string, UniqueObservation>();
  const errorCounts = new Map<string, number>();
  let succeeded = 0;
  for (const record of records) {
    if (isObservation(record)) {
      succeeded += 1;
      slots.set(record.observedAtUtc, {
        observedAtUtc: record.observedAtUtc,
        temperature: record.temperature,
        condition: record.condition ?? "",
      });
    } else {
      const reason = record.error ?? "Причина не указана.";
      errorCounts.set(reason, (errorCounts.get(reason) ?? 0) + 1);
    }
  }
  const observations = [...slots.values()].sort((a, b) => a.observedAtUtc.localeCompare(b.observedAtUtc));
  return {
    periodStartMs,
    periodEndMs,
    requests: records.length,
    succeeded,
    failed: records.length - succeeded,
    observations,
    temperature: temperatureStats(observations),
    errors: [...errorCounts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}
