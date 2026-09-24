import type { SummaryCandidate, SummaryLookup } from "../service/types.ts";
import type { ScheduleRow } from "../store/types.ts";
import { isoTime, reply, type ToolReply } from "./toolResult.ts";

const state = (row: ScheduleRow) => (row.cancelledAtMs === null ? ("active" as const) : ("cancelled" as const));

function describeSchedule(row: ScheduleRow): string {
  const status = state(row) === "active" ? "активно" : "отменено";
  const cadence = `опрос каждые ${row.collectEverySeconds} с, сводка каждые ${row.summaryEverySeconds} с`;
  return `${row.id}: ${row.city}, ${cadence}, ${status}`;
}

function toCandidates(candidates: readonly SummaryCandidate[]) {
  return candidates.map(({ schedule, publishedAtMs }) => ({
    scheduleId: schedule.id,
    city: schedule.city,
    collectEverySeconds: schedule.collectEverySeconds,
    summaryEverySeconds: schedule.summaryEverySeconds,
    scheduleStatus: state(schedule),
    ...(publishedAtMs === null ? {} : { lastPublishedAt: isoTime(publishedAtMs) }),
  }));
}

function notFoundReply(known: readonly SummaryCandidate[]): ToolReply {
  const structured = { status: "not_found" as const, candidates: toCandidates(known) };
  if (known.length === 0) return reply("Расписание не найдено: расписаний ещё нет.", structured);
  const lines = known.map(({ schedule }) => `- ${describeSchedule(schedule)}`);
  const text = ["Расписание не найдено. Существующие расписания (сообщи их пользователю):", ...lines].join("\n");
  return reply(text, structured);
}

function noSummaryReply(schedule: ScheduleRow): ToolReply {
  const active = state(schedule) === "active";
  const nextSummaryAt = isoTime(schedule.nextSummaryAtMs);
  const hint = active
    ? `Ближайшая публикация не раньше ${nextSummaryAt}; она выполняется, пока запущен \`scheduler run\`.`
    : "Расписание отменено.";
  return reply(`Для расписания ${schedule.id} сводка ещё не опубликована. ${hint}`, {
    status: "no_summary",
    scheduleId: schedule.id,
    city: schedule.city,
    scheduleStatus: state(schedule),
    ...(active ? { nextSummaryAt } : {}),
  });
}

function ambiguousReply(found: Extract<SummaryLookup, { status: "ambiguous" }>): ToolReply {
  const lines = found.candidates.map(({ schedule }) => `- ${describeSchedule(schedule)}`);
  return reply(["Найдено несколько расписаний. Повторите запрос с scheduleId:", ...lines].join("\n"), {
    status: "ambiguous",
    candidates: toCandidates(found.candidates),
  });
}

/** Текст найденной сводки — сохранённый Markdown без изменений; остальные исходы — короткие пояснения. */
export function summaryReply(found: SummaryLookup): ToolReply {
  switch (found.status) {
    case "found":
      return reply(found.summary.markdown, {
        status: "found",
        scheduleId: found.schedule.id,
        city: found.schedule.city,
        scheduleStatus: state(found.schedule),
        publishedAt: isoTime(found.summary.publishedAtMs),
        markdown: found.summary.markdown,
      });
    case "no_summary":
      return noSummaryReply(found.schedule);
    case "ambiguous":
      return ambiguousReply(found);
    case "not_found":
      return notFoundReply(found.known);
  }
}
