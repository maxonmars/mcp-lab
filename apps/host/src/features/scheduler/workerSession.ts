import type { SchedulerPort, WeatherPort } from "./contracts.ts";
import { SchedulerError } from "./errors.ts";
import { type Connect, connectStdio, type McpCaller } from "./mcp.ts";
import { schedulerPort } from "./schedulerPort.ts";
import { type SchedulerServerConfig, schedulerServerArgs } from "./serverArgs.ts";
import { weatherPort } from "./weatherPort.ts";

export type WorkerSessionConfig = SchedulerServerConfig &
  Readonly<{ weatherEntrypoint: string; connect?: Connect | undefined }>;

export type WorkerSession = Readonly<{ scheduler: SchedulerPort; weather: WeatherPort; close(): Promise<void> }>;

/** Два постоянных соединения worker: состояние планировщика и структурированная погода. Закрываются вместе. */
export async function openWorkerSession(config: WorkerSessionConfig): Promise<WorkerSession> {
  const connect = config.connect ?? connectStdio;
  const { nodeExecutable, timeoutMs } = config;
  const scheduler = await connect(
    { command: nodeExecutable, args: schedulerServerArgs(config, "worker"), timeoutMs },
    "scheduler",
  );
  let weather: McpCaller;
  try {
    weather = await connect(
      { command: nodeExecutable, args: [config.weatherEntrypoint, "--ignore-sigint"], timeoutMs },
      "weather",
    );
  } catch (error) {
    await scheduler.close().catch(() => {});
    throw error;
  }
  return {
    scheduler: schedulerPort(scheduler),
    weather: weatherPort(weather),
    close: async () => {
      const results = await Promise.allSettled([weather.close(), scheduler.close()]);
      if (results.some((result) => result.status === "rejected")) throw new SchedulerError("CLOSE_FAILED");
    },
  };
}
