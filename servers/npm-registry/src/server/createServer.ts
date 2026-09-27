import { McpServer } from "@modelcontextprotocol/server";
import type { NpmRegistryDependencies } from "../registry/types.ts";
import { registerGetNpmPackage } from "./packageTool.ts";

export const SERVER_NAME = "mcp-lab-npm-registry";
export const SERVER_VERSION = "0.1.0";

export function createNpmRegistryServer(deps: NpmRegistryDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerGetNpmPackage(server, deps);
  return server;
}
