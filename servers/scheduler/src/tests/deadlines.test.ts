import { describe, expect, it } from "vitest";
import { nextDeadline, ON_TIME_GRACE_MS } from "../service/deadlines.ts";

describe("nextDeadline", () => {
  it("своевременный запуск (в пределах дрожания таймера) сохраняет сетку сроков", () => {
    expect(nextDeadline(10_000, 10, 9_990)).toBe(20_000);
    expect(nextDeadline(10_000, 10, 10_000)).toBe(20_000);
    expect(nextDeadline(10_000, 10, 10_400)).toBe(20_000);
    expect(nextDeadline(10_000, 10, 10_000 + ON_TIME_GRACE_MS)).toBe(20_000);
  });

  it("опоздание больше порога — отсчёт от фактического запуска, в том числе меньше интервала", () => {
    expect(nextDeadline(10_000, 10, 10_000 + ON_TIME_GRACE_MS + 1)).toBe(21_001);
    expect(nextDeadline(10_000, 10, 13_000)).toBe(23_000);
    expect(nextDeadline(20_000, 60, 61_000)).toBe(121_000);
  });

  it("после простоя следующий срок — фактический запуск + интервал, без догоняющих сроков", () => {
    expect(nextDeadline(10_000, 10, 3_610_000)).toBe(3_620_000);
  });
});
