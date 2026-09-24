export type SchedulerServerConfig = Readonly<{
  nodeExecutable: string;
  /** Абсолютный путь к точке входа `servers/scheduler`. */
  entrypoint: string;
  dbPath: string;
  reportsDir: string;
  timeoutMs: number;
}>;

/** worker — служебные операции; public — инструменты для модели и чтения сводки. */
export type SchedulerServerMode = "public" | "worker";

export function schedulerServerArgs(config: SchedulerServerConfig, mode: SchedulerServerMode): string[] {
  const base = [config.entrypoint, "--db", config.dbPath, "--reports-dir", config.reportsDir];
  return mode === "worker" ? [...base, "--worker", "--ignore-sigint"] : base;
}
