import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { readSchedulerSummary } from "../../features/scheduler/index.ts";
import {
  MODEL_TEXT,
  SECOND,
  scripted,
  serverConfig,
  summaryReply,
  TestClock,
  terminalA,
  terminalB,
  toolCall,
  useTempRoot,
} from "./schedulerHarness.ts";

useTempRoot();

describe("ежедневная сводка через Agent", () => {
  it("в 18:00 запускает Agent с MCP-данными, сохраняет отчёт и печатает его без реплики", async () => {
    const city = "Новосибирск, Россия";
    const scheduled = scripted([
      toolCall("schedule_daily_weather_summary", {
        city,
        collectEverySeconds: 10,
        summaryAtLocalTime: "18:00",
        timeZone: "Asia/Novosibirsk",
      }),
      { type: "text", content: "Ежедневное расписание создано." },
    ]);
    const created = await terminalB(
      ["ask", "Делай сводку погоды каждый день в 18:00 по Новосибирску"],
      scheduled.model,
    );
    expect(created.code).toBe(0);
    expect(created.out).toContain("MCP: scheduler › schedule_daily_weather_summary — выполнено");

    const pending = await readSchedulerSummary(serverConfig(), "Новосибирск");
    expect(pending.status).toBe("no_summary");
    if (pending.status !== "no_summary") throw new Error("Ежедневное расписание не создано.");
    const missing = await readSchedulerSummary(serverConfig(), "Омск");
    expect(missing).toMatchObject({
      status: "not_found",
      candidates: [{ summaryAtLocalTime: "18:00", timeZone: "Asia/Novosibirsk" }],
    });
    const dueAt = Date.parse(pending.nextSummaryAt ?? "");
    expect(Number.isFinite(dueAt)).toBe(true);

    const requests: ModelRequest[] = [];
    const workerModel = {
      complete: async (request: ModelRequest) => {
        requests.push(request);
        return requests.length === 1 ? toolCall("get_weather_report_data", {}) : summaryReply(request);
      },
    };
    const controller = new AbortController();
    const worker = await terminalA({
      clock: new TestClock(dueAt, dueAt + SECOND, () => controller.abort()),
      controller,
      model: workerModel,
    });

    expect(worker.code).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual(["get_weather_report_data"]);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Запросов за период: 1"),
    });
    expect(worker.out).toContain(MODEL_TEXT);
    expect(worker.out).toContain("── Сводка · Новосибирск, Россия ──");

    const saved = await terminalB(["scheduler", "summary", "Новосибирск"], scripted([]).model, false);
    expect(saved.code).toBe(0);
    expect(saved.out).toContain(MODEL_TEXT);
    expect(saved.out).toContain("requests: 1");
  });
});
