import { expect, it } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { McpDiscoveryError, McpToolSourceError } from "../../../features/mcp/index.ts";
import { SchedulerError } from "../../../features/scheduler/index.ts";
import { describeError, InputError } from "../index.ts";

it("указывает лимит токенов только при finish_reason length", () => {
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "length" }))).toContain("лимиту токенов");
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "content_filter" }))).not.toContain("лимит");
});

it("показывает безопасную причину, но не текст неизвестной ошибки", () => {
  expect(describeError(new InputError("Неверный флаг"))).toBe("Неверный флаг");
  expect(describeError(new AgentError("MODEL_FAILURE", { status: 429 }))).toBe("API вернул HTTP 429.");
  expect(describeError(new AgentError("MODEL_FAILURE"))).toBe("Запрос к модели не выполнен.");
  expect(describeError(new Error("secret"))).not.toContain("secret");
});

it("переводит собственные ошибки MCP без текста SDK", () => {
  expect(describeError(new McpDiscoveryError("ROOT_NOT_DIRECTORY"))).toContain("не является каталогом");
  expect(describeError(new McpDiscoveryError("CONNECT_FAILED"))).toContain("соединение");
  expect(describeError(new McpDiscoveryError("TOOLS_UNSUPPORTED"))).toContain("не объявил");
  expect(describeError(new McpDiscoveryError("TIMEOUT", { stage: "connect" }))).toContain("подключения");
  expect(describeError(new McpDiscoveryError("TIMEOUT", { stage: "listTools" }))).toContain("списка");
});

it("переводит новые коды Agent для tool calling", () => {
  expect(describeError(new AgentError("INVALID_TOOL_CALL_COUNT"))).toContain("без вызовов инструментов");
  expect(describeError(new AgentError("UNKNOWN_TOOL_CALL"))).toContain("неизвестный инструмент");
  expect(describeError(new AgentError("INVALID_TOOL_ARGUMENTS"))).toContain("некорректные аргументы");
  expect(describeError(new AgentError("TOOL_CALL_LIMIT_EXCEEDED", { limit: 6 }))).toBe(
    "Модель превысила лимит вызовов инструментов за реплику (6).",
  );
  expect(describeError(new AgentError("TOOL_CALL_LIMIT_EXCEEDED"))).toBe(
    "Модель превысила лимит вызовов инструментов за реплику.",
  );
});

it("переводит ошибки McpToolSourceError без утечки stage-нейтральных случаев, называя сервер", () => {
  expect(describeError(new McpToolSourceError("SERVER_START_FAILED", { server: "open-meteo" }))).toContain(
    "«open-meteo»",
  );
  expect(describeError(new McpToolSourceError("TOOLS_UNSUPPORTED", { server: "open-meteo" }))).toContain("не объявил");
  expect(describeError(new McpToolSourceError("LIST_TOOLS_FAILED", { server: "open-meteo" }))).toContain(
    "список инструментов",
  );
  expect(describeError(new McpToolSourceError("CALL_TOOL_FAILED", { server: "open-meteo" }))).toContain(
    "вызов инструмента",
  );
  expect(describeError(new McpToolSourceError("UNSUPPORTED_TOOL_RESULT", { server: "open-meteo" }))).toContain(
    "неподдерживаемый формат",
  );
  expect(describeError(new McpToolSourceError("TIMEOUT", { server: "open-meteo", stage: "callTool" }))).toContain(
    "«open-meteo» на стадии callTool",
  );
  expect(describeError(new McpToolSourceError("CLOSE_FAILED", { server: "npm-registry" }))).toContain("«npm-registry»");
});

it("переводит ошибки планировщика: отказ второго worker и отдельные формулировки для серверов", () => {
  expect(describeError(new SchedulerError("WORKER_ALREADY_RUNNING", "scheduler"))).toBe(
    "Планировщик уже запущен для этой базы.",
  );
  expect(describeError(new SchedulerError("SERVER_START_FAILED", "weather"))).toContain("сервер погоды");
  expect(describeError(new SchedulerError("SERVER_START_FAILED", "scheduler"))).toContain("сервер планировщика");
  expect(describeError(new SchedulerError("CONNECT_FAILED", "scheduler"))).toContain("соединение");
  expect(describeError(new SchedulerError("CALL_FAILED", "scheduler"))).toContain("не выполнил вызов");
  expect(describeError(new SchedulerError("TIMEOUT", "weather"))).toContain("таймаут");
  expect(describeError(new SchedulerError("INVALID_RESULT", "scheduler"))).toContain("неподдерживаемый формат");
  expect(describeError(new SchedulerError("CLOSE_FAILED"))).toContain("закрыть соединения");
});
