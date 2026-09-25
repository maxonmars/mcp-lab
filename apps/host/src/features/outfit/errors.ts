export type OutfitStep = "weather" | "recommend" | "save";
export type OutfitErrorCode = "INVALID_LOCATION" | "STEP_FAILED" | "EMPTY_RESULT" | "CALL_FAILED" | "HIDDEN_TOOL";

export type OutfitErrorData = Readonly<{ step?: OutfitStep; reason?: string }>;

/** reason — безопасный текст isError от сервера; при CALL_FAILED причина — в cause. */
export class OutfitError extends Error {
  readonly code: OutfitErrorCode;
  readonly step: OutfitStep | undefined;
  readonly reason: string | undefined;

  constructor(code: OutfitErrorCode, data: OutfitErrorData = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "OutfitError";
    this.code = code;
    this.step = data.step;
    this.reason = data.reason;
  }
}

const STEP_LABELS: Readonly<Record<OutfitStep, string>> = {
  weather: "погода и прогноз",
  recommend: "совет по одежде",
  save: "сохранение совета",
};

/** causeText — описание ошибки транспорта для CALL_FAILED; по умолчанию без подробностей. */
export function describeOutfitError(error: OutfitError, causeText = "MCP-вызов не выполнен."): string {
  const step = error.step ? `Шаг «${STEP_LABELS[error.step]}»` : "Шаг";
  switch (error.code) {
    case "INVALID_LOCATION":
      return "Укажите город: от 2 до 100 символов.";
    case "STEP_FAILED":
      return `${step} не выполнен: ${error.reason ?? "причина не указана."}`;
    case "EMPTY_RESULT":
      return `${step} вернул пустой результат.`;
    case "CALL_FAILED":
      return `${step} не выполнен: ${causeText}`;
    case "HIDDEN_TOOL":
      return "Инструмент доступен только внутри пайплайна совета по одежде.";
  }
}
