export const GITHUB_API_HOST = "https://api.github.com";

/** Меньше mcp.timeoutMs host по умолчанию (10 с): таймаут API вернётся моделью как isError, а не оборвёт MCP-вызов. */
export const GITHUB_API_TIMEOUT_MS = 8_000;

export const DEFAULT_RELEASES_LIMIT = 10;
export const MAX_RELEASES_LIMIT = 20;
export const MAX_RELEASE_NOTES_CHARS = 4_000;
