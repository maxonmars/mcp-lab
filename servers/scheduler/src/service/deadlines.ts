export const COLLECT_INTERVAL_LIMITS_SECONDS = { min: 5, max: 86_400 } as const;
export const SUMMARY_INTERVAL_LIMITS_SECONDS = { min: 10, max: 86_400 } as const;

/** Опоздание до этого порога — дрожание таймера; большее считается простоем. */
export const ON_TIME_GRACE_MS = 1_000;

/**
 * Следующий срок после запуска в executedAtMs: своевременный запуск сохраняет сетку сроков (без дрейфа),
 * при простое отсчёт идёт от фактического запуска — без цикла «догоняющих» запусков.
 */
export function nextDeadline(dueMs: number, intervalSeconds: number, executedAtMs: number): number {
  const interval = intervalSeconds * 1000;
  return executedAtMs - dueMs <= ON_TIME_GRACE_MS ? dueMs + interval : executedAtMs + interval;
}
