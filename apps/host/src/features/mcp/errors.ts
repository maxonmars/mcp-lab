export type McpDiscoveryErrorCode =
  | "ROOT_NOT_FOUND"
  | "ROOT_NOT_DIRECTORY"
  | "ROOT_CHECK_FAILED"
  | "SERVER_START_FAILED"
  | "CONNECT_FAILED"
  | "TOOLS_UNSUPPORTED"
  | "LIST_TOOLS_FAILED"
  | "TIMEOUT"
  | "CLOSE_FAILED";

export type McpDiscoveryStage = "connect" | "listTools";

export type McpDiscoveryErrorData = Readonly<{
  stage?: McpDiscoveryStage;
}>;

export class McpDiscoveryError extends Error {
  readonly code: McpDiscoveryErrorCode;
  readonly stage: McpDiscoveryStage | undefined;
  readonly data: McpDiscoveryErrorData;

  constructor(code: McpDiscoveryErrorCode, data: McpDiscoveryErrorData = {}) {
    super(code);
    this.name = "McpDiscoveryError";
    this.code = code;
    this.stage = data.stage;
    this.data = data;
  }
}
