export type ServiceErrorCode = "WORKER_NOT_STARTED" | "SCHEDULE_NOT_FOUND";

const MESSAGES: Readonly<Record<ServiceErrorCode, string>> = {
  WORKER_NOT_STARTED: "Служебная операция доступна только после worker_start в этом соединении.",
  SCHEDULE_NOT_FOUND: "Расписание с таким ID не найдено.",
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode) {
    super(MESSAGES[code]);
    this.name = "ServiceError";
    this.code = code;
  }
}
