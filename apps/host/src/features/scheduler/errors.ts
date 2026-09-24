export type SchedulerErrorCode =
  | "WORKER_ALREADY_RUNNING"
  | "SERVER_START_FAILED"
  | "CONNECT_FAILED"
  | "CALL_FAILED"
  | "TIMEOUT"
  | "INVALID_RESULT"
  | "CLOSE_FAILED";

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;
  readonly server: "scheduler" | "weather" | undefined;

  constructor(code: SchedulerErrorCode, server?: "scheduler" | "weather") {
    super(code);
    this.name = "SchedulerError";
    this.code = code;
    this.server = server;
  }
}
