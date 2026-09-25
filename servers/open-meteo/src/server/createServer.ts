import { McpServer } from "@modelcontextprotocol/server";
import type { WeatherDependencies } from "../weather/types.ts";
import { type OutfitDependencies, registerOutfitTools } from "./outfitTools.ts";
import { registerWeatherTool } from "./weatherTool.ts";

export const SERVER_NAME = "mcp-lab-open-meteo";
export const SERVER_VERSION = "0.1.0";

/** Без outfit — только get_current_weather; с outfit — ещё recommend_outfit и save_outfit_advice. */
export function createWeatherServer(deps: WeatherDependencies, outfit?: OutfitDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  registerWeatherTool(server, deps);
  if (outfit) registerOutfitTools(server, outfit);
  return server;
}
