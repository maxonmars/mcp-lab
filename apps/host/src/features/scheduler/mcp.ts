import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { SchedulerError } from "./errors.ts";

export type McpEndpoint = Readonly<{ command: string; args: readonly string[]; timeoutMs: number }>;
export type ServerName = "scheduler" | "weather";

export type CallResult = Readonly<{
  isError?: boolean | undefined;
  content: readonly unknown[];
  structuredContent?: unknown;
}>;

/** Узкий вид MCP-клиента: тесты подставляют его вместо процесса. */
export interface McpCaller {
  call(name: string, args: Readonly<Record<string, unknown>>): Promise<CallResult>;
  close(): Promise<void>;
}

export type Connect = (endpoint: McpEndpoint, server: ServerName) => Promise<McpCaller>;

const startCodes = ["EACCES", "ENOENT", "ENOTDIR", "EPERM", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE"];

const isTimeout = (error: unknown): boolean => error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout;
const hasStartCode = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && startCodes.includes(String(error.code));

/** Постоянное stdio-соединение: worker держит его весь запуск, в отличие от сессии на один ask. */
export const connectStdio: Connect = async (endpoint, server) => {
  let transport: StdioClientTransport;
  try {
    transport = new StdioClientTransport({ command: endpoint.command, args: [...endpoint.args], stderr: "ignore" });
  } catch {
    throw new SchedulerError("SERVER_START_FAILED", server);
  }
  const client = new Client({ name: "mcp-lab-host", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  try {
    await client.connect(transport, { timeout: endpoint.timeoutMs });
  } catch (error) {
    await client.close().catch(() => {});
    if (isTimeout(error)) throw new SchedulerError("TIMEOUT", server);
    throw new SchedulerError(hasStartCode(error) ? "SERVER_START_FAILED" : "CONNECT_FAILED", server);
  }
  return {
    call: async (name, args) => {
      try {
        return await client.callTool({ name, arguments: { ...args } }, { timeout: endpoint.timeoutMs });
      } catch (error) {
        throw new SchedulerError(isTimeout(error) ? "TIMEOUT" : "CALL_FAILED", server);
      }
    },
    close: () => client.close(),
  };
};
