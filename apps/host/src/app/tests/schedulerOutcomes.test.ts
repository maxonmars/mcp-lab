import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import type { SchedulerPort, SummaryReadResult, WorkerSession } from "../../features/scheduler/index.ts";
import { run } from "../compose.ts";
import {
  CITY_PROMPT,
  MODEL_TEXT,
  SECOND,
  scripted,
  summaryReply,
  TestClock,
  tempRoot,
  terminal,
  terminalB,
  toolCall,
  useTempRoot,
} from "./schedulerHarness.ts";

useTempRoot();

async function summaryWith(result: SummaryReadResult) {
  const io = terminal();
  const code = await run({
    argv: ["scheduler", "summary", "Омск"],
    cwd: tempRoot(),
    env: {},
    nodeExecutable: process.execPath,
    terminal: io.io,
    readSchedulerSummary: async () => result,
  });
  return { code, out: io.out(), err: io.err() };
}

describe("scheduler summary: исходы чтения", () => {
  it.each<[string, SummaryReadResult, string]>([
    ["нет расписаний вообще", { status: "not_found", candidates: [] }, "Расписание не найдено: расписаний ещё нет."],
    [
      "нет совпадения, но есть другие расписания",
      {
        status: "not_found",
        candidates: [
          {
            scheduleId: "sch_a",
            city: "Новосибирск, Россия",
            collectEverySeconds: 10,
            summaryEverySeconds: 60,
            scheduleStatus: "active",
          },
        ],
      },
      "Существующие: sch_a («Новосибирск, Россия», активно). Укажите ID или название как в расписании.",
    ],
    [
      "сводка ещё не опубликована",
      {
        status: "no_summary",
        scheduleId: "sch_1",
        city: "Омск",
        scheduleStatus: "active",
        nextSummaryAt: "2026-09-24T10:01:00.000Z",
      },
      "sch_1 («Омск») сводка ещё не опубликована. Ближайшая публикация не раньше 2026-09-24T10:01:00.000Z.",
    ],
    [
      "расписание отменено до первой сводки",
      { status: "no_summary", scheduleId: "sch_1", city: "Омск", scheduleStatus: "cancelled" },
      "Расписание отменено.",
    ],
    [
      "несколько расписаний",
      {
        status: "ambiguous",
        candidates: [
          {
            scheduleId: "sch_a",
            city: "Омск",
            collectEverySeconds: 10,
            summaryEverySeconds: 60,
            scheduleStatus: "active",
          },
          {
            scheduleId: "sch_b",
            city: "Омск",
            collectEverySeconds: 900,
            summaryEverySeconds: 3600,
            scheduleStatus: "cancelled",
          },
        ],
      },
      "sch_a («Омск», активно), sch_b («Омск», отменено). Укажите ID.",
    ],
  ])("%s: сообщение в stderr, код 1, ничего в stdout", async (_name, result, message) => {
    const outcome = await summaryWith(result);
    expect(outcome.code).toBe(1);
    expect(outcome.err).toContain(message);
    expect(outcome.out).toBe("");
  });

  it("два расписания одного города через настоящий сервер: команда перечисляет ID, чтение по ID доступно", async () => {
    const create = () =>
      scripted([
        toolCall("schedule_weather", { city: "Новосибирск", collectEverySeconds: 10, summaryEverySeconds: 60 }),
        { type: "text", content: "Готово." },
      ]).model;
    await terminalB(["ask", CITY_PROMPT], create());
    await terminalB(["ask", CITY_PROMPT], create());
    const result = await terminalB(["scheduler", "summary", "новосибирск"], scripted([]).model, false);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(
      /sch_[0-9a-f]{8} \(«Новосибирск», активно\), sch_[0-9a-f]{8} \(«Новосибирск», активно\)\. Укажите ID\./,
    );
  });
});

function fakeSession(fileSynced: boolean): WorkerSession {
  let served = false;
  const scheduler: SchedulerPort = {
    start: async () => {},
    dueTasks: async () => {
      const tasks = served ? [] : [{ scheduleId: "sch_1", city: "Омск", collectDue: false, summaryDue: true }];
      served = true;
      return { tasks, nextDueAtMs: null };
    },
    recordPoll: async () => ({ locationChanged: false }),
    history: async () => [],
    publishSummary: async () => ({ fileSynced }),
    recordSummaryFailure: vi.fn(async () => {}),
  };
  return { scheduler, weather: { observe: async () => ({ ok: false, error: "нет" }) }, close: async () => {} };
}

async function workerWith(reply: (request: ModelRequest) => ModelCompletion, fileSynced = true) {
  const io = terminal();
  const controller = new AbortController();
  const session = fakeSession(fileSynced);
  const code = await run({
    argv: ["scheduler", "run"],
    cwd: tempRoot(),
    env: { LAB_LLM_API_KEY: "test-key" },
    nodeExecutable: process.execPath,
    terminal: io.io,
    createModel: () => ({ complete: async (request) => reply(request) }),
    clock: new TestClock(0, 5 * SECOND, () => controller.abort()),
    interrupt: () => ({ signal: controller.signal, release: () => {} }),
    openWorkerSession: async () => session,
  });
  return { code, out: io.out(), err: io.err(), session };
}

describe("scheduler run: события worker", () => {
  it("отказ модели — предупреждение в stderr с причиной, прежняя сводка сохраняется, worker завершается кодом 0", async () => {
    const outcome = await workerWith(() => ({ type: "text", content: "" }));
    expect(outcome.code).toBe(0);
    expect(outcome.err).toContain(
      "Сводка для «Омск» не опубликована: Модель вернула пустой ответ. Прежняя сводка сохранена.",
    );
    expect(outcome.out).not.toContain("── Сводка");
    expect(outcome.out).toContain("Планировщик остановлен.");
    expect(outcome.session.scheduler.recordSummaryFailure).toHaveBeenCalledOnce();
  });

  it("копия .md не записана — сводка всё равно печатается, предупреждение уходит в stderr", async () => {
    const outcome = await workerWith(summaryReply, false);
    expect(outcome.code).toBe(0);
    expect(outcome.out).toContain("── Сводка · Омск ──");
    expect(outcome.out).toContain(MODEL_TEXT);
    expect(outcome.err).toContain("Копия .md не записана");
  });
});
