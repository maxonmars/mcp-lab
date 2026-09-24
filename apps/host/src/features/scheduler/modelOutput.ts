import type { Aggregate } from "./aggregate.ts";
import { isoSeconds } from "./format.ts";

const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

/** Убирает разметку, которой модель может обернуть строку («**Период (UTC):**», «- Период…»). */
function plainLines(text: string): string[] {
  return text.split("\n").map((line) =>
    line
      .replaceAll(/[*_`>#]/g, "")
      .replace(/^\s*[-•]\s+/, "")
      .trim(),
  );
}

function hasPeriod(line: string, expected: readonly string[]): boolean {
  const found = line.match(TIMESTAMP) ?? [];
  return found.length === expected.length && found.every((value, index) => value === expected[index]);
}

/** Возвращает причину отказа или undefined, если период и число наблюдений совпали с рассчитанными. */
export function checkModelText(text: string, agg: Aggregate): string | undefined {
  if (!text.trim()) return "Модель вернула пустой ответ.";
  const lines = plainLines(text);
  const periods = lines.filter((line) => /^период(?!\p{L})/iu.test(line));
  const counts = lines.filter((line) => /^уникальных наблюдений(?!\p{L})/iu.test(line));
  if (periods.length === 0) return "В ответе модели нет строки с периодом.";
  if (counts.length === 0) return "В ответе модели нет строки с числом уникальных наблюдений.";
  const expected = [isoSeconds(agg.periodStartMs), isoSeconds(agg.periodEndMs)];
  if (!periods.every((line) => hasPeriod(line, expected))) return "Период в ответе модели не совпадает с рассчитанным.";
  if (!counts.every((line) => line.match(/:\s*(\d+)\.?\s*$/)?.[1] === String(agg.observations.length))) {
    return "Число уникальных наблюдений в ответе модели не совпадает с рассчитанным.";
  }
  return undefined;
}
