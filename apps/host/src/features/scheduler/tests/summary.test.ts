import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { aggregate } from "../aggregate.ts";
import { buildContext, MAX_SAMPLE_OBSERVATIONS, sampleObservations } from "../context.ts";
import type { PollRecord } from "../contracts.ts";
import { checkModelText } from "../modelOutput.ts";
import { assembleReport } from "../report.ts";
import { SECOND, T0 } from "./support.ts";

const START = T0 - 24 * 3600 * SECOND;
const ok = (at: number, slot: string, temperature: number, condition = "ясно"): PollRecord => ({
  requestedAtMs: at,
  ok: true,
  observedAtUtc: slot,
  temperature,
  condition,
});
const failed = (at: number, error?: string): PollRecord => ({
  requestedAtMs: at,
  ok: false,
  ...(error ? { error } : {}),
});

describe("aggregate", () => {
  it("без записей нет температурных показателей", () => {
    const result = aggregate([], START, T0);
    expect(result).toMatchObject({ requests: 0, succeeded: 0, failed: 0, temperature: undefined, observations: [] });
  });

  it("запросы считаются все, температура — по последнему ответу каждого слота, слоты упорядочены по времени", () => {
    const result = aggregate(
      [
        ok(1, "2026-09-24T10:15:00Z", 20),
        ok(2, "2026-09-24T10:00:00Z", 10),
        ok(3, "2026-09-24T10:00:00Z", 12),
        failed(4, "сеть"),
        failed(5, "сеть"),
        failed(6),
      ],
      START,
      T0,
    );
    expect(result).toMatchObject({ requests: 6, succeeded: 3, failed: 3 });
    expect(result.observations.map((item) => [item.observedAtUtc, item.temperature])).toEqual([
      ["2026-09-24T10:00:00Z", 12],
      ["2026-09-24T10:15:00Z", 20],
    ]);
    expect(result.temperature).toEqual({ first: 12, last: 20, change: 8, min: 12, max: 20, mean: 16 });
    expect(result.errors).toEqual([
      { reason: "сеть", count: 2 },
      { reason: "Причина не указана.", count: 1 },
    ]);
  });

  it("одно наблюдение: изменение нулевое", () => {
    const result = aggregate([ok(1, "2026-09-24T10:00:00Z", 7)], START, T0);
    expect(result.temperature).toEqual({ first: 7, last: 7, change: 0, min: 7, max: 7, mean: 7 });
  });
});

describe("sampleObservations", () => {
  const observations = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      observedAtUtc: `t${String(index).padStart(3, "0")}`,
      temperature: index,
      condition: "",
    }));

  it("возвращает все, если их не больше предела, иначе — равномерную выборку с первым и последним", () => {
    expect(sampleObservations(observations(5), 8)).toHaveLength(5);
    const sample = sampleObservations(observations(100), MAX_SAMPLE_OBSERVATIONS);
    expect(sample).toHaveLength(MAX_SAMPLE_OBSERVATIONS);
    expect(sample[0]?.temperature).toBe(0);
    expect(sample.at(-1)?.temperature).toBe(99);
    expect(sample.map((item) => item.temperature)).toEqual(
      [...sample.map((item) => item.temperature)].sort((a, b) => a - b),
    );
  });
});

describe("buildContext", () => {
  it("содержит обязательные строки дословно и факты в Markdown без JSON", () => {
    const result = aggregate([ok(1, "2026-09-24T10:00:00Z", 12.34), failed(2, "сеть")], START, T0);
    const context = buildContext("Новосибирск", result);
    expect(context).toContain(
      "    Период (UTC): 2026-09-23T10:00:00Z — 2026-09-24T10:00:00Z\n    Уникальных наблюдений: 1\n",
    );
    expect(context).toContain("Запросов за период: 2 (успешных: 1, с ошибкой: 1)");
    expect(context).toContain("- 2026-09-24T10:00:00Z: 12.3 °C, ясно");
    expect(context).toContain("- сеть — 1");
    expect(context).not.toMatch(/[{}[\]]/);
  });
});

describe("checkModelText", () => {
  const agg = aggregate([ok(1, "2026-09-24T10:00:00Z", 12)], START, T0);
  const lines = "Период (UTC): 2026-09-23T10:00:00Z — 2026-09-24T10:00:00Z\nУникальных наблюдений: 1";

  it("принимает точные строки и строки с обычной разметкой", () => {
    expect(checkModelText(`${lines}\n\nТекст.`, agg)).toBeUndefined();
    expect(
      checkModelText(
        `**Период (UTC):** 2026-09-23T10:00:00Z — 2026-09-24T10:00:00Z\n> Уникальных наблюдений: **1**`,
        agg,
      ),
    ).toBeUndefined();
  });

  it("отклоняет пустой ответ, чужой период, чужое число и повторную строку с другим числом", () => {
    expect(checkModelText("", agg)).toBe("Модель вернула пустой ответ.");
    expect(checkModelText(lines.replace("09-23", "09-22"), agg)).toContain("Период в ответе модели не совпадает");
    expect(checkModelText(lines.replace("наблюдений: 1", "наблюдений: 2"), agg)).toContain(
      "Число уникальных наблюдений",
    );
    expect(checkModelText(`${lines}\nУникальных наблюдений: 3`, agg)).toContain("Число уникальных наблюдений");
    expect(checkModelText("Уникальных наблюдений: 1", agg)).toContain("нет строки с периодом");
    expect(checkModelText("Период (UTC): 2026-09-23T10:00:00Z — 2026-09-24T10:00:00Z", agg)).toContain(
      "нет строки с числом",
    );
  });

  it("не принимает период с лишней или недостающей границей", () => {
    expect(checkModelText(lines.replace(" — 2026-09-24T10:00:00Z", ""), agg)).toContain(
      "Период в ответе модели не совпадает",
    );
  });
});

describe("assembleReport", () => {
  it("frontmatter — корректный YAML даже для города с двоеточием; текст модели входит дословно", () => {
    const agg = aggregate([ok(1, "2026-09-24T10:00:00Z", 12)], START, T0);
    const markdown = assembleReport({
      scheduleId: "sch_1",
      city: "Санкт-Петербург: центр",
      aggregate: agg,
      modelText: "\n  Свободный текст модели.\n",
      generatedAtMs: T0 + 500,
    });
    const [, frontmatter, body] = markdown.split(/^---\n|\n---\n/m);
    expect(parse(frontmatter ?? "")).toEqual({
      scheduleId: "sch_1",
      city: "Санкт-Петербург: центр",
      periodStart: "2026-09-23T10:00:00Z",
      periodEnd: "2026-09-24T10:00:00Z",
      generatedAt: "2026-09-24T10:00:00Z",
      requests: 1,
      succeeded: 1,
      failed: 0,
      uniqueObservations: 1,
    });
    expect(body).toBe("\n# Сводка погоды: Санкт-Петербург: центр\n\nСвободный текст модели.\n");
  });
});
