import { AgentError } from "../../core/index.ts";
import { McpDiscoveryError, McpToolSourceError } from "../../features/mcp/index.ts";
import { describeOutfitError, OutfitError } from "../../features/outfit/index.ts";
import { SchedulerError } from "../../features/scheduler/index.ts";

export class InputError extends Error {}

export function describeError(error: unknown): string {
  if (error instanceof InputError) return error.message;
  if (error instanceof McpDiscoveryError) return describeMcpError(error);
  if (error instanceof McpToolSourceError) return describeMcpToolSourceError(error);
  if (error instanceof SchedulerError) return describeSchedulerError(error);
  if (error instanceof OutfitError) {
    return describeOutfitError(error, error.cause === undefined ? undefined : describeError(error.cause));
  }
  if (!(error instanceof AgentError)) return "Не удалось выполнить операцию.";
  switch (error.code) {
    case "EMPTY_INPUT":
      return "Введите непустую реплику.";
    case "EMPTY_RESPONSE":
      return "Модель вернула пустой ответ.";
    case "INCOMPLETE_RESPONSE":
      return error.data.reason === "length"
        ? "Ответ прерван по лимиту токенов. Настройки доступны в config show."
        : "Модель завершила генерацию без обычного ответа.";
    case "MODEL_FAILURE":
      return error.data.status ? `API вернул HTTP ${error.data.status}.` : "Запрос к модели не выполнен.";
    case "INVALID_TOOL_CALL_COUNT":
      return "Модель вернула некорректное число вызовов инструмента.";
    case "UNKNOWN_TOOL_CALL":
      return "Модель запросила неизвестный инструмент.";
    case "INVALID_TOOL_ARGUMENTS":
      return "Модель передала некорректные аргументы инструмента.";
    case "TOOL_CALL_LIMIT_EXCEEDED":
      return "Модель повторно запросила инструмент после результата вызова.";
  }
}

function describeMcpError(error: McpDiscoveryError): string {
  switch (error.code) {
    case "ROOT_NOT_FOUND":
      return "Учебная папка MCP не существует.";
    case "ROOT_NOT_DIRECTORY":
      return "Путь учебной папки MCP не является каталогом.";
    case "ROOT_CHECK_FAILED":
      return "Не удалось проверить учебную папку MCP.";
    case "SERVER_START_FAILED":
      return "Не удалось запустить MCP-сервер.";
    case "CONNECT_FAILED":
      return "Не удалось установить MCP-соединение.";
    case "TOOLS_UNSUPPORTED":
      return "MCP-сервер не объявил поддержку инструментов.";
    case "LIST_TOOLS_FAILED":
      return "Не удалось получить список MCP-инструментов.";
    case "TIMEOUT":
      return error.stage === "connect"
        ? "Истёк таймаут MCP-подключения."
        : "Истёк таймаут получения списка MCP-инструментов.";
    case "CLOSE_FAILED":
      return "Не удалось корректно закрыть MCP-соединение.";
  }
}

function describeMcpToolSourceError(error: McpToolSourceError): string {
  switch (error.code) {
    case "SERVER_START_FAILED":
      return "Не удалось запустить MCP-сервер погоды.";
    case "CONNECT_FAILED":
      return "Не удалось установить соединение с MCP-сервером погоды.";
    case "TOOLS_UNSUPPORTED":
      return "MCP-сервер погоды не объявил поддержку инструментов.";
    case "LIST_TOOLS_FAILED":
      return "Не удалось получить список инструментов MCP-сервера погоды.";
    case "CALL_TOOL_FAILED":
      return "Не удалось выполнить вызов инструмента MCP-сервера погоды.";
    case "UNSUPPORTED_TOOL_RESULT":
      return "MCP-сервер погоды вернул неподдерживаемый формат результата.";
    case "TIMEOUT":
      return `Истёк таймаут MCP-сервера погоды на стадии ${error.stage ?? "неизвестно"}.`;
    case "CLOSE_FAILED":
      return "Не удалось корректно закрыть соединение с MCP-сервером погоды.";
  }
}

function describeSchedulerError(error: SchedulerError): string {
  const server = error.server === "weather" ? "погоды" : "планировщика";
  switch (error.code) {
    case "WORKER_ALREADY_RUNNING":
      return "Планировщик уже запущен для этой базы.";
    case "SERVER_START_FAILED":
      return `Не удалось запустить MCP-сервер ${server}.`;
    case "CONNECT_FAILED":
      return `Не удалось установить соединение с MCP-сервером ${server}.`;
    case "CALL_FAILED":
      return `MCP-сервер ${server} не выполнил вызов.`;
    case "TIMEOUT":
      return `Истёк таймаут MCP-сервера ${server}.`;
    case "INVALID_RESULT":
      return `MCP-сервер ${server} вернул неподдерживаемый формат результата.`;
    case "CLOSE_FAILED":
      return "Не удалось корректно закрыть соединения планировщика.";
  }
}
