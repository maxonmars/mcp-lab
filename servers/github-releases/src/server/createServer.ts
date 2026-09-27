import { McpServer } from "@modelcontextprotocol/server";
import type { GithubApiDependencies } from "../github/types.ts";
import { registerGithubReleaseTools } from "./releaseTools.ts";

export const SERVER_NAME = "mcp-lab-github-releases";
export const SERVER_VERSION = "0.1.0";

export function createGithubReleasesServer(deps: GithubApiDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerGithubReleaseTools(server, deps);
  return server;
}
