import type { Aggregate, UniqueObservation } from "./aggregate.ts";
import { formatNumber, formatSigned, isoSeconds } from "./format.ts";

export const PERIOD_LABEL = "Период (UTC)";
export const OBSERVATIONS_LABEL = "Уникальных наблюдений";
export const MAX_SAMPLE_OBSERVATIONS = 8;
const MAX_LISTED_ERRORS = 5;

export const periodLine = (agg: Aggregate): string =>
  `${PERIOD_LABEL}: ${isoSeconds(agg.periodStartMs)} — ${isoSeconds(agg.periodEndMs)}`;
export const observationsLine = (agg: Aggregate): string => `${OBSERVATIONS_LABEL}: ${agg.observations.length}`;

/** Равномерная выборка с обязательными первым и последним наблюдением. */
export function sampleObservations(observations: readonly UniqueObservation[], max: number): UniqueObservation[] {
  if (observations.length <= max) return [...observations];
  const indexes = new Set(
    Array.from({ length: max }, (_, i) => Math.round((i * (observations.length - 1)) / (max - 1))),
  );
  return [...indexes].map((index) => observations[index] as UniqueObservation);
}

function facts(agg: Aggregate): string[] {
  const lines = [
    `- Запросов за период: ${agg.requests} (успешных: ${agg.succeeded}, с ошибкой: ${agg.failed}).`,
    `- Уникальных наблюдений: ${agg.observations.length}; повторные ответы с тем же временем наблюдения считаются одним.`,
  ];
  const stats = agg.temperature;
  if (!stats) return [...lines, "- Температура: данных нет, успешных наблюдений в периоде нет."];
  return [
    ...lines,
    `- Температура по уникальным наблюдениям: первая ${formatNumber(stats.first)} °C, последняя ${formatNumber(stats.last)} °C, изменение ${formatSigned(stats.change)} °C.`,
    `- Минимум ${formatNumber(stats.min)} °C, максимум ${formatNumber(stats.max)} °C, среднее ${formatNumber(stats.mean)} °C.`,
  ];
}

function samples(agg: Aggregate): string[] {
  if (agg.observations.length === 0) return [];
  const shown = sampleObservations(agg.observations, MAX_SAMPLE_OBSERVATIONS);
  return [
    "",
    `## Примеры наблюдений (показано ${shown.length} из ${agg.observations.length})`,
    ...shown.map((item) => `- ${item.observedAtUtc}: ${formatNumber(item.temperature)} °C, ${item.condition}`),
  ];
}

function errors(agg: Aggregate): string[] {
  if (agg.errors.length === 0) return [];
  const listed = agg.errors.slice(0, MAX_LISTED_ERRORS).map((item) => `- ${item.reason} — ${item.count}`);
  return ["", "## Причины ошибок запросов", ...listed];
}

/** Markdown-контекст для модели: вычисленные факты, обязательные строки и ограниченная выборка наблюдений. */
export function buildContext(city: string, agg: Aggregate): string {
  return [
    `# Данные для сводки: ${city}`,
    "",
    "## Обязательные строки",
    "Скопируй дословно первыми двумя строками ответа:",
    "",
    `    ${periodLine(agg)}`,
    `    ${observationsLine(agg)}`,
    "",
    "## Вычисленные факты",
    ...facts(agg),
    ...samples(agg),
    ...errors(agg),
    "",
  ].join("\n");
}
