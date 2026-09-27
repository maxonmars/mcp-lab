import { describe, expect, it } from "vitest";
import { AgentError, type ModelCompletion } from "../../../core/index.ts";
import { SchedulerError } from "../errors.ts";
import { FakeModel, FakeScheduler, goodReply, MODEL_TEXT, runScenario, SECOND, T0 } from "./support.ts";

function dailyScheduler(): FakeScheduler {
  const scheduler = new FakeScheduler();
  scheduler.addDailySchedule(T0, 10, T0 + 60 * SECOND);
  return scheduler;
}

const toolCall: ModelCompletion = {
  type: "tool_calls",
  calls: [{ id: "report-data-1", name: "get_weather_report_data", arguments: {} }],
};

describe("worker: ежедневная агентная сводка", () => {
  it("Agent вызывает фасад над MCP-историей и публикует ответ после сохранения", async () => {
    const scheduler = dailyScheduler();
    const model = new FakeModel((request) => (request.toolChoice === "auto" ? toolCall : goodReply(request)));
    const { events } = await runScenario({ scheduler, model, endAt: T0 + 60 * SECOND });

    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]).toMatchObject({
      toolChoice: "auto",
      tools: [{ name: "get_weather_report_data", inputSchema: { type: "object", additionalProperties: false } }],
    });
    expect(model.requests[0]?.messages[0]).toEqual({ role: "system", content: "DAILY-SYSTEM-PROMPT" });
    expect(model.requests[1]?.toolChoice).toBe("none");
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "report-data-1",
      content: expect.stringContaining("Запросов за период: 6 (успешных: 6, с ошибкой: 0)"),
    });
    expect(scheduler.log.slice(-5)).toEqual(["poll", "history", "publish", "report", "stopped"]);
    expect(scheduler.summaries[0]).toContain(MODEL_TEXT);
    expect(events.reports).toHaveLength(1);
    expect(scheduler.schedules[0]?.nextSummaryAtMs).toBe(T0 + 60 * SECOND + 24 * 3600 * SECOND);
  });

  it("ответ без вызова инструмента не заменяет сохранённую сводку", async () => {
    const scheduler = dailyScheduler();
    scheduler.summaries.push("ПРЕЖНЯЯ СВОДКА");
    const model = new FakeModel(() => ({ type: "text", content: "Погода хорошая." }));
    const { events } = await runScenario({ scheduler, model, endAt: T0 + 60 * SECOND });

    expect(model.requests).toHaveLength(1);
    expect(scheduler.log).not.toContain("history");
    expect(scheduler.summaries).toEqual(["ПРЕЖНЯЯ СВОДКА"]);
    expect(scheduler.failures).toEqual(["Агент не вызвал инструмент get_weather_report_data."]);
    expect(events.reports).toEqual([]);
    expect(events.failed[0]?.reason).toBe(scheduler.failures[0]);
  });

  it("неверные аргументы инструмента и ошибочный текст модели фиксируются как отказы", async () => {
    const invalidArgs = dailyScheduler();
    const wrongCall = new FakeModel(() => ({
      type: "tool_calls",
      calls: [{ id: "1", name: "get_weather_report_data", arguments: { city: "Омск" } }],
    }));
    await runScenario({ scheduler: invalidArgs, model: wrongCall, endAt: T0 + 60 * SECOND });
    expect(invalidArgs.failures).toEqual(["Ошибка модели: INVALID_TOOL_ARGUMENTS."]);
    expect(invalidArgs.log).not.toContain("history");

    const invalidText = dailyScheduler();
    invalidText.summaries.push("ПРЕЖНЯЯ СВОДКА");
    const model = new FakeModel((request) =>
      request.toolChoice === "auto" ? toolCall : { type: "text", content: "Нет обязательных строк." },
    );
    await runScenario({ scheduler: invalidText, model, endAt: T0 + 60 * SECOND });
    expect(invalidText.log).toContain("history");
    expect(invalidText.failures).toEqual(["В ответе модели нет строки с периодом."]);
    expect(invalidText.summaries).toEqual(["ПРЕЖНЯЯ СВОДКА"]);
  });

  it("ошибка MCP-истории завершает worker, отказ модели после истории сохраняется как причина", async () => {
    const failedHistory = dailyScheduler();
    failedHistory.history = async () => {
      throw new SchedulerError("TIMEOUT", "scheduler");
    };
    const model = new FakeModel(() => toolCall);
    await expect(runScenario({ scheduler: failedHistory, model, endAt: T0 + 60 * SECOND })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(failedHistory.failures).toEqual([]);
    expect(failedHistory.log.at(-1)).toBe("stopped");

    const rejectedModel = dailyScheduler();
    const secondFails = new FakeModel((request) =>
      request.toolChoice === "auto" ? toolCall : Promise.reject(new AgentError("MODEL_FAILURE", { status: 503 })),
    );
    await runScenario({ scheduler: rejectedModel, model: secondFails, endAt: T0 + 60 * SECOND });
    expect(rejectedModel.failures).toEqual(["Ошибка модели: MODEL_FAILURE (HTTP 503)."]);
    expect(rejectedModel.summaries).toEqual([]);
  });

  it("ошибка сохранения не печатает неподтверждённую сводку", async () => {
    const scheduler = dailyScheduler();
    scheduler.publishSummary = async () => {
      scheduler.log.push("publish");
      throw new SchedulerError("CALL_FAILED", "scheduler");
    };
    const model = new FakeModel((request) => (request.toolChoice === "auto" ? toolCall : goodReply(request)));
    await expect(runScenario({ scheduler, model, endAt: T0 + 60 * SECOND })).rejects.toMatchObject({
      code: "CALL_FAILED",
    });
    expect(scheduler.log.slice(-3)).toEqual(["history", "publish", "stopped"]);
    expect(scheduler.summaries).toEqual([]);
    expect(scheduler.failures).toEqual([]);
  });
});
