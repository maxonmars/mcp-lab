export type GithubApiErrorCode =
  | "REPOSITORY_NOT_FOUND"
  | "RELEASE_NOT_FOUND"
  | "RATE_LIMITED"
  | "BAD_STATUS"
  | "NETWORK_FAILED"
  | "INVALID_PAYLOAD";

/** list — 404 списка релизов репозитория; release — 404 конкретного тега. */
export type GithubStage = "list" | "release";

export class GithubApiError extends Error {
  readonly code: GithubApiErrorCode;

  constructor(code: GithubApiErrorCode) {
    super(code);
    this.name = "GithubApiError";
    this.code = code;
  }
}

const MESSAGES: Readonly<Record<GithubApiErrorCode, string>> = {
  REPOSITORY_NOT_FOUND: "Репозиторий GitHub не найден.",
  RELEASE_NOT_FOUND: "Релиз GitHub с таким тегом не найден.",
  RATE_LIMITED: "Исчерпан лимит запросов GitHub API без токена (60 в час); повторите позже.",
  BAD_STATUS: "GitHub API вернул ошибку.",
  NETWORK_FAILED: "Не удалось обратиться к GitHub API.",
  INVALID_PAYLOAD: "GitHub API вернул некорректный ответ.",
};

export function describeGithubApiError(error: unknown): string {
  if (error instanceof GithubApiError) return MESSAGES[error.code];
  return "Не удалось получить данные GitHub API.";
}
