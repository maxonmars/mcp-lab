# npm-registry MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md).

- Самостоятельный npm workspace `@mcp-lab/npm-registry-server`. Не импортирует host и другие серверы.
- Регистрирует один инструмент `get_npm_package`: последняя версия (dist-tag `latest`), описание,
  лицензия, домашняя страница и репозиторий GitHub публичного npm registry.
- Один запрос `GET https://registry.npmjs.org/<name>/latest`; таймаут — именованная константа
  `NPM_REGISTRY_TIMEOUT_MS`, короче таймаута MCP host по умолчанию (10 с), поэтому таймаут API
  возвращается моделью как `isError`, а не обрывает MCP-вызов.
- `fetch` передаётся через dependency injection; `process`, argv и env — только в `src/app/main.ts`.
- stdout — только MCP protocol; любой лог — только stderr.
- `src/index.ts` экспортирует factory сервера, имя инструмента и типы.
- Ошибки не содержат тело ответа, query-параметры и стек; только код причины.
- Распознавание репозитория GitHub из строки или `{ url }` — в `src/registry/repository.ts`.
- Тесты используют подменённый `fetch` и протокольный `InMemoryTransport`, без настоящего npm registry.
