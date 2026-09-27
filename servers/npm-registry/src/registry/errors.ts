export type NpmRegistryErrorCode = "PACKAGE_NOT_FOUND" | "BAD_STATUS" | "NETWORK_FAILED" | "INVALID_PAYLOAD";

export class NpmRegistryError extends Error {
  readonly code: NpmRegistryErrorCode;

  constructor(code: NpmRegistryErrorCode) {
    super(code);
    this.name = "NpmRegistryError";
    this.code = code;
  }
}

const MESSAGES: Readonly<Record<NpmRegistryErrorCode, string>> = {
  PACKAGE_NOT_FOUND: "Пакет не найден в npm registry.",
  BAD_STATUS: "npm registry вернул ошибку.",
  NETWORK_FAILED: "Не удалось обратиться к npm registry.",
  INVALID_PAYLOAD: "npm registry вернул некорректный ответ.",
};

export function describeNpmRegistryError(error: unknown): string {
  if (error instanceof NpmRegistryError) return MESSAGES[error.code];
  return "Не удалось получить данные npm registry.";
}
