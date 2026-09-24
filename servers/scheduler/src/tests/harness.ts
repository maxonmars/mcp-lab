import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchedulerService } from "../index.ts";
import type { Observation } from "../store/types.ts";

export const T0 = Date.parse("2026-09-24T10:00:00Z");

export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observedAtUtc: "2026-09-24T10:00:00Z",
    observedAtLocal: "2026-09-24T17:00",
    locationName: "Новосибирск",
    latitude: 55.03,
    longitude: 82.92,
    temperature: 12,
    apparentTemperature: 10,
    relativeHumidity: 60,
    precipitation: 0,
    windSpeed: 10,
    condition: "пасмурно",
    ...overrides,
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** Часы управляются тестом; каждый open() — отдельный SchedulerService (отдельный процесс в терминах базы). */
export function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-lab-scheduler-"));
  mkdirSync(join(dir, "data"));
  const clock = { now: T0 };
  const opened: SchedulerService[] = [];
  let counter = 0;
  const harness = {
    dir,
    dbPath: join(dir, "data", "scheduler.sqlite"),
    reportsDir: join(dir, "reports"),
    clock,
    open(newId: () => string = () => `sch_${String(++counter).padStart(8, "0")}`): SchedulerService {
      const service = new SchedulerService({
        dbPath: harness.dbPath,
        reportsDir: harness.reportsDir,
        now: () => clock.now,
        newId,
      });
      opened.push(service);
      return service;
    },
    cleanup(): void {
      for (const service of opened) service.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return harness;
}
