import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ToolDefinition, ToolInvocation, ToolResult, ToolSource } from "../../core/index.ts";
import { McpToolSourceError } from "./toolSourceErrors.ts";
import type { StdioToolSourceOptions } from "./toolSourceTypes.ts";

const serverStartCodes = new Set([
  "EACCES",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
]);

function createClient(): Client {
  return new Client({ name: "mcp-lab-host", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
}

async function connect(client: Client, transport: StdioClientTransport, timeoutMs: number): Promise<void> {
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error) {
    if (isRequestTimeout(error)) throw new McpToolSourceError("TIMEOUT", { stage: "connect" });
    if (hasServerStartCode(error)) throw new McpToolSourceError("SERVER_START_FAILED");
    throw new McpToolSourceError("CONNECT_FAILED");
  }
}

async function listTools(client: Client, timeoutMs: number): Promise<readonly ToolDefinition[]> {
  try {
    const result = await client.listTools(undefined, { timeout: timeoutMs });
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema ?? {}) as ToolDefinition["inputSchema"],
    }));
  } catch (error) {
    if (isRequestTimeout(error)) throw new McpToolSourceError("TIMEOUT", { stage: "listTools" });
    throw new McpToolSourceError("LIST_TOOLS_FAILED");
  }
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function extractText(content: readonly unknown[]): string {
  if (content.length === 0) throw new McpToolSourceError("UNSUPPORTED_TOOL_RESULT");
  const texts: string[] = [];
  for (const block of content) {
    if (!isTextBlock(block)) throw new McpToolSourceError("UNSUPPORTED_TOOL_RESULT");
    texts.push(block.text);
  }
  return texts.join("\n");
}

async function callTool(client: Client, invocation: ToolInvocation, timeoutMs: number): Promise<ToolResult> {
  let result: Awaited<ReturnType<Client["callTool"]>>;
  try {
    result = await client.callTool({ name: invocation.name, arguments: invocation.arguments }, { timeout: timeoutMs });
  } catch (error) {
    if (isRequestTimeout(error)) throw new McpToolSourceError("TIMEOUT", { stage: "callTool" });
    throw new McpToolSourceError("CALL_TOOL_FAILED");
  }
  return { content: extractText(result.content), isError: result.isError === true };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function hasServerStartCode(error: unknown): boolean {
  return [...serverStartCodes].some((code) => hasCode(error, code));
}

function isRequestTimeout(error: unknown): boolean {
  return error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout;
}

/** Ошибки `use` (например, AgentError из Agent.respond) проходят наружу без изменения типа. */
export async function withStdioToolSource<T>(
  options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<T>,
): Promise<T> {
  let transport: StdioClientTransport;
  try {
    transport = new StdioClientTransport({ command: options.command, args: [...options.args], stderr: "ignore" });
  } catch {
    throw new McpToolSourceError("SERVER_START_FAILED");
  }
  const client = createClient();
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  try {
    await connect(client, transport, options.timeoutMs);
    if (!client.getServerCapabilities()?.tools) throw new McpToolSourceError("TOOLS_UNSUPPORTED");
    const source: ToolSource = {
      listTools: () => listTools(client, options.timeoutMs),
      callTool: (invocation) => callTool(client, invocation, options.timeoutMs),
    };
    result = await use(source);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      await client.close();
    } catch {
      if (!failed) {
        failed = true;
        failure = new McpToolSourceError("CLOSE_FAILED");
      }
    }
  }
  if (failed) throw failure;
  return result as T;
}
