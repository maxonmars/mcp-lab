import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { McpDiscoveryError } from "./errors.ts";
import type { FilesystemDiscoveryOptions, McpDiscoveryResult, McpToolSummary } from "./types.ts";

const requireFromHost = createRequire(new URL("../../../package.json", import.meta.url));
const serverStartCodes = new Set([
  "EACCES",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
]);

async function verifyRoot(root: string): Promise<void> {
  if (!isAbsolute(root)) throw new McpDiscoveryError("ROOT_CHECK_FAILED");
  try {
    const details = await stat(root);
    if (!details.isDirectory()) throw new McpDiscoveryError("ROOT_NOT_DIRECTORY");
  } catch (error) {
    if (error instanceof McpDiscoveryError) throw error;
    if (hasCode(error, "ENOENT")) throw new McpDiscoveryError("ROOT_NOT_FOUND");
    throw new McpDiscoveryError("ROOT_CHECK_FAILED");
  }
}

async function resolveServerEntrypoint(): Promise<string> {
  let entrypoint: string;
  try {
    entrypoint = requireFromHost.resolve("@modelcontextprotocol/server-filesystem/dist/index.js");
    if (!(await stat(entrypoint)).isFile()) throw new Error("Filesystem server entrypoint is not a file");
  } catch {
    throw new McpDiscoveryError("SERVER_START_FAILED");
  }
  return entrypoint;
}

function createClient(): Client {
  return new Client(
    { name: "mcp-lab-host", version: "0.1.0" },
    {
      versionNegotiation: { mode: "legacy" },
      supportedProtocolVersions: ["2025-11-25"],
    },
  );
}

async function connect(client: Client, transport: StdioClientTransport, timeoutMs: number): Promise<void> {
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error) {
    if (isRequestTimeout(error)) throw new McpDiscoveryError("TIMEOUT", { stage: "connect" });
    if (hasServerStartCode(error)) throw new McpDiscoveryError("SERVER_START_FAILED");
    throw new McpDiscoveryError("CONNECT_FAILED");
  }
}

async function listTools(client: Client, timeoutMs: number): Promise<readonly McpToolSummary[]> {
  try {
    const result = await client.listTools(undefined, { timeout: timeoutMs });
    return summarizeTools(result.tools);
  } catch (error) {
    if (error instanceof McpDiscoveryError) throw error;
    if (isRequestTimeout(error)) throw new McpDiscoveryError("TIMEOUT", { stage: "listTools" });
    throw new McpDiscoveryError("LIST_TOOLS_FAILED");
  }
}

function serverInfo(client: Client): McpDiscoveryResult["server"] {
  const server = client.getServerVersion();
  if (!server?.name || !server?.version) throw new McpDiscoveryError("CONNECT_FAILED");
  return { name: server.name, version: server.version };
}

function summarizeTools(tools: unknown): readonly McpToolSummary[] {
  if (!Array.isArray(tools)) throw new McpDiscoveryError("LIST_TOOLS_FAILED");
  return tools.map((tool) => {
    if (!isTool(tool)) throw new McpDiscoveryError("LIST_TOOLS_FAILED");
    return tool.description === undefined ? { name: tool.name } : { name: tool.name, description: tool.description };
  });
}

function isTool(value: unknown): value is McpToolSummary {
  if (!isRecord(value)) return false;
  const { name, description } = value;
  return typeof name === "string" && (description === undefined || typeof description === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export async function discoverFilesystemTools(options: FilesystemDiscoveryOptions): Promise<McpDiscoveryResult> {
  await verifyRoot(options.root);
  const entrypoint = await resolveServerEntrypoint();
  let transport: StdioClientTransport;
  try {
    transport = new StdioClientTransport({
      command: options.nodeExecutable,
      args: [entrypoint, options.root],
      stderr: "ignore",
    });
  } catch {
    throw new McpDiscoveryError("SERVER_START_FAILED");
  }
  const client = createClient();
  let result: McpDiscoveryResult | undefined;
  let failure: McpDiscoveryError | undefined;
  try {
    await connect(client, transport, options.timeoutMs);
    if (!client.getServerCapabilities()?.tools) throw new McpDiscoveryError("TOOLS_UNSUPPORTED");
    result = { server: serverInfo(client), tools: await listTools(client, options.timeoutMs) };
  } catch (error) {
    failure = error instanceof McpDiscoveryError ? error : new McpDiscoveryError("LIST_TOOLS_FAILED");
  } finally {
    try {
      await client.close();
    } catch {
      if (!failure) failure = new McpDiscoveryError("CLOSE_FAILED");
    }
  }
  if (failure) throw failure;
  if (!result) throw new McpDiscoveryError("LIST_TOOLS_FAILED");
  return result;
}
