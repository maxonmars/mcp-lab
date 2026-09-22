export type AgentErrorCode = "EMPTY_INPUT" | "EMPTY_RESPONSE" | "MODEL_FAILURE" | "INCOMPLETE_RESPONSE";

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly data: Readonly<Record<string, string | number>>;

  constructor(code: AgentErrorCode, data: Readonly<Record<string, string | number>> = {}) {
    super(code);
    this.name = "AgentError";
    this.code = code;
    this.data = Object.freeze({ ...data });
  }
}
