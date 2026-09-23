import { McpServer } from "@modelcontextprotocol/server";
import type { WeatherDependencies } from "../weather/types.ts";
import { registerWeatherTool } from "./weatherTool.ts";

export const SERVER_NAME = "mcp-lab-open-meteo";
export const SERVER_VERSION = "0.1.0";

export function createWeatherServer(deps: WeatherDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerWeatherTool(server, deps);
  return server;
}
