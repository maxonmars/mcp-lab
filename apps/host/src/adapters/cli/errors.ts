import { AgentError } from "../../core/index.ts";

export class InputError extends Error {}

export function describeError(error: unknown): string {
  if (error instanceof InputError) return error.message;
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
