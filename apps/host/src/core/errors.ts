export type AgentErrorCode =
  | "EMPTY_INPUT"
  | "EMPTY_RESPONSE"
  | "MODEL_FAILURE"
  | "INCOMPLETE_RESPONSE"
  | "INVALID_TOOL_CALL_COUNT"
  | "UNKNOWN_TOOL_CALL"
  | "INVALID_TOOL_ARGUMENTS"
  | "TOOL_CALL_LIMIT_EXCEEDED";

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
