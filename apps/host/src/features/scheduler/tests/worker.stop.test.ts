import { describe, expect, it, vi } from "vitest";
import type { PollResult } from "../contracts.ts";
import { runWorker } from "../worker.ts";
import {
  FakeClock,
  FakeModel,
  FakeScheduler,
  FakeWeather,
  MODEL_TEXT,
  observation,
  recordingEvents,
  SECOND,
  T0,
} from "./support.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(weather: FakeWeather, model: FakeModel) {
  const scheduler = new FakeScheduler();
  scheduler.addSchedule(T0, 10, 20);
  const controller = new AbortController();
  const clock = new FakeClock(T0 + 20 * SECOND, T0 + 3600 * SECOND, () => controller.abort());
  const events = recordingEvents(scheduler.log);
  const running = runWorker({ scheduler, weather, model, clock, events, systemPrompt: "SYSTEM" }, controller.signal);
  return { scheduler, controller, events, running };
}

describe("worker: остановка по Ctrl+C", () => {
  it("во время опроса: опрос доводится до записи, сводка не запускается, остановка сообщается", async () => {
    const gate = deferred<PollResult>();
    const weather = new FakeWeather(() => gate.promise);
    const model = new FakeModel();
    const { scheduler, controller, running } = setup(weather, model);

    await vi.waitFor(() => expect(weather.cities).toHaveLength(1));
    controller.abort();
    gate.resolve({ ok: true, observation: observation() });
    await running;

    expect(scheduler.polls).toHaveLength(1);
    expect(model.requests).toEqual([]);
    expect(scheduler.log).toEqual(["start", "started", "poll", "stopped"]);
  });

  it("во время генерации: сводка сохраняется и печатается, затем новые операции не начинаются", async () => {
    const gate = deferred<void>();
    const model = new FakeModel(async (request) => {
      await gate.promise;
      const lines = (request.messages.at(-1) as { content: string }).content
        .split("\n")
        .filter((line) => line.startsWith("    "))
        .map((line) => line.trim());
      return { type: "text", content: `${lines.join("\n")}\n\n${MODEL_TEXT}` };
    });
    const { scheduler, controller, events, running } = setup(new FakeWeather(), model);

    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    controller.abort();
    gate.resolve();
    await running;

    expect(scheduler.summaries).toHaveLength(1);
    expect(events.reports).toHaveLength(1);
    expect(scheduler.log.slice(-4)).toEqual(["history", "publish", "report", "stopped"]);
    expect(scheduler.polls).toHaveLength(1);
  });

  it("сигнал до начала цикла: worker занимает право, но не выполняет операций", async () => {
    const weather = new FakeWeather();
    const model = new FakeModel();
    const scheduler = new FakeScheduler();
    scheduler.addSchedule(T0 - 3600 * SECOND);
    const controller = new AbortController();
    controller.abort();
    const clock = new FakeClock(T0, T0 + 60 * SECOND, () => {});
    const events = recordingEvents(scheduler.log);
    await runWorker({ scheduler, weather, model, clock, events, systemPrompt: "" }, controller.signal);
    expect(scheduler.log).toEqual(["start", "started", "stopped"]);
    expect(weather.cities).toEqual([]);
  });
});
