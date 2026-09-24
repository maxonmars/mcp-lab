import type { PollResult, ScheduleRow, SummaryRow } from "../store/types.ts";

export type ServiceDeps = Readonly<{
  dbPath: string;
  reportsDir: string;
  now: () => number;
  newId: () => string;
}>;

export type NewSchedule = Readonly<{ city: string; collectEverySeconds: number; summaryEverySeconds: number }>;
export type SummaryQuery = Readonly<{ scheduleId?: string | undefined; city?: string | undefined }>;

export type SummaryCandidate = Readonly<{ schedule: ScheduleRow; publishedAtMs: number | null }>;

export type SummaryLookup =
  | Readonly<{ status: "found"; schedule: ScheduleRow; summary: SummaryRow }>
  | Readonly<{ status: "no_summary"; schedule: ScheduleRow }>
  | Readonly<{ status: "ambiguous"; candidates: readonly SummaryCandidate[] }>
  | Readonly<{ status: "not_found"; known: readonly SummaryCandidate[] }>;

export type CancelOutcome = Readonly<{ status: "cancelled" | "already_cancelled" | "not_found" }>;

export type DueTask = Readonly<{ scheduleId: string; city: string; collectDue: boolean; summaryDue: boolean }>;
export type DueTasks = Readonly<{ tasks: readonly DueTask[]; nextDueAtMs: number | null }>;

export type PollInput = Readonly<{ scheduleId: string; requestedAtMs: number; result: PollResult }>;
export type PollOutcome = Readonly<{ locationChanged: boolean }>;

export type PublishInput = Readonly<{
  scheduleId: string;
  startedAtMs: number;
  periodStartMs: number;
  periodEndMs: number;
  uniqueObservations: number;
  markdown: string;
}>;
export type PublishOutcome = Readonly<{ fileSynced: boolean }>;

export type SummaryFailureInput = Readonly<{ scheduleId: string; startedAtMs: number; reason: string }>;
