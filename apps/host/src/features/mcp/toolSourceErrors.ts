export type McpToolSourceErrorCode =
  | "SERVER_START_FAILED"
  | "CONNECT_FAILED"
  | "TOOLS_UNSUPPORTED"
  | "LIST_TOOLS_FAILED"
  | "CALL_TOOL_FAILED"
  | "UNSUPPORTED_TOOL_RESULT"
  | "TIMEOUT"
  | "CLOSE_FAILED";

export type McpToolSourceStage = "connect" | "listTools" | "callTool";

export type McpToolSourceErrorData = Readonly<{ stage?: McpToolSourceStage }>;

export class McpToolSourceError extends Error {
  readonly code: McpToolSourceErrorCode;
  readonly stage: McpToolSourceStage | undefined;
  readonly data: McpToolSourceErrorData;

  constructor(code: McpToolSourceErrorCode, data: McpToolSourceErrorData = {}) {
    super(code);
    this.name = "McpToolSourceError";
    this.code = code;
    this.stage = data.stage;
    this.data = data;
  }
}
