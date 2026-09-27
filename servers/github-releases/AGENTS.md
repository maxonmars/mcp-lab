# github-releases MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md).

- Самостоятельный npm workspace `@mcp-lab/github-releases-server`. Не импортирует host и другие серверы.
- Регистрирует `list_github_releases` (черновики пропускаются) и `get_github_release` (заметки и метаданные
  по точному тегу) публичного GitHub REST API. Токена и `Authorization` нет; лимит без токена — 60 запросов
  в час на IP, `RATE_LIMITED` называет его явно.
- Каждый запрос — `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` и
  `User-Agent: mcp-lab-github-releases`; без `User-Agent` GitHub отклоняет запрос.
- Таймаут — именованная константа `GITHUB_API_TIMEOUT_MS`, короче таймаута MCP host по умолчанию (10 с),
  поэтому таймаут API возвращается моделью как `isError`, а не обрывает MCP-вызов.
- `fetch` передаётся через dependency injection; `process`, argv и env — только в `src/app/main.ts`.
- stdout — только MCP protocol; любой лог — только stderr.
- `src/index.ts` экспортирует factory сервера, имена инструментов и типы.
- Различие 404 списка и тега передаётся параметром stage в `src/github/request.ts`, а не догадкой по тексту.
- Заметки релиза обрезаются по `MAX_RELEASE_NOTES_CHARS`; ошибки не содержат тело ответа и стек.
- Тесты используют подменённый `fetch` и протокольный `InMemoryTransport`, без настоящего GitHub API.
