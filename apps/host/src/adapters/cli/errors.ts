import { AgentError } from "../../core/index.ts";
import { McpDiscoveryError } from "../../features/mcp/index.ts";

export class InputError extends Error {}

export function describeError(error: unknown): string {
  if (error instanceof InputError) return error.message;
  if (error instanceof McpDiscoveryError) return describeMcpError(error);
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
