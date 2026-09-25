import { AdviceModelError } from "./deepseek.ts";

export const ADVICE_TITLE = "# Что надеть сейчас";
export const WEATHER_SECTION_TITLE = "## Данные о погоде, на которых основан совет";

/** Совет модели и исходный текст погоды без изменений: основание ответа остаётся в сохранённом файле. */
export function composeAdvice(modelMarkdown: string, weatherText: string): string {
  return `${ADVICE_TITLE}\n\n${modelMarkdown.trim()}\n\n${WEATHER_SECTION_TITLE}\n\n${weatherText}\n`;
}

export function describeAdviceError(error: unknown): string {
  if (!(error instanceof AdviceModelError)) return "Не удалось получить совет модели.";
  switch (error.code) {
    case "MODEL_FAILURE":
      return error.status === undefined
        ? "Запрос к модели DeepSeek не выполнен."
        : `Модель DeepSeek вернула HTTP ${error.status}.`;
    case "INCOMPLETE_RESPONSE":
      return "Модель DeepSeek не завершила ответ (например, по лимиту токенов).";
    case "EMPTY_RESPONSE":
      return "Модель DeepSeek вернула пустой ответ.";
  }
}
