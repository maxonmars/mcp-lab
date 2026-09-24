import { McpServer } from "@modelcontextprotocol/server";
import type { SchedulerService } from "../service/service.ts";
import { registerPublicTools } from "./publicTools.ts";
import { registerWorkerTools } from "./workerTools.ts";

export const SERVER_NAME = "mcp-lab-scheduler";
export const SERVER_VERSION = "0.1.0";

/** public — инструменты для модели и пользователя; worker — служебные операции фонового цикла host. */
export type SchedulerMode = "public" | "worker";

export function createSchedulerServer(deps: { service: SchedulerService; mode: SchedulerMode }): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  if (deps.mode === "worker") registerWorkerTools(server, deps.service);
  else registerPublicTools(server, deps.service);
  return server;
}
