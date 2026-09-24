import { stringify } from "yaml";
import type { Aggregate } from "./aggregate.ts";
import { isoSeconds } from "./format.ts";

export type ReportInput = Readonly<{
  scheduleId: string;
  city: string;
  aggregate: Aggregate;
  modelText: string;
  generatedAtMs: number;
}>;

/** Итоговый отчёт: frontmatter и заголовок добавляет host, содержательная часть — дословный текст модели. */
export function assembleReport(input: ReportInput): string {
  const { aggregate } = input;
  const frontmatter = stringify({
    scheduleId: input.scheduleId,
    city: input.city,
    periodStart: isoSeconds(aggregate.periodStartMs),
    periodEnd: isoSeconds(aggregate.periodEndMs),
    generatedAt: isoSeconds(input.generatedAtMs),
    requests: aggregate.requests,
    succeeded: aggregate.succeeded,
    failed: aggregate.failed,
    uniqueObservations: aggregate.observations.length,
  });
  return `---\n${frontmatter}---\n\n# Сводка погоды: ${input.city}\n\n${input.modelText.trim()}\n`;
}
