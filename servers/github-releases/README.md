# github-releases MCP server

## Назначение

Самостоятельный MCP-сервер поверх публичного [GitHub REST API](https://docs.github.com/en/rest/releases):
список опубликованных релизов репозитория и заметки одного релиза по точному тегу. Не импортирует host.
Используется в сценарии [«Проверка обновления зависимости»](../../docs/adr/0007-orchestration-mcp.md).
Токена и `Authorization` нет; лимит без токена — 60 запросов в час на IP.

## list_github_releases

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.

### Вход

- `owner: string` — владелец репозитория, `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`.
- `repo: string` — имя репозитория, `^[A-Za-z0-9._-]{1,100}$`, но не `.` и не `..`.
- `limit?: number` — целое от 1 до `MAX_RELEASES_LIMIT` (20), по умолчанию `DEFAULT_RELEASES_LIMIT` (10).

### Запрос и результат

`GET https://api.github.com/repos/{owner}/{repo}/releases?per_page={limit}`. Черновики (`draft: true`)
пропускаются. Пустой список — не ошибка: отдельная фраза «нет опубликованных релизов GitHub». Текст и
`structuredContent`:

```text
Релизы GitHub colinhacks/zod (показано 5, новые сначала):
- v4.6.5 — «v4.6.5», опубликован 2026-09-13T23:25:34Z — https://github.com/colinhacks/zod/releases/tag/v4.6.5
- v4.7.0-beta.1 — «v4.7.0-beta.1», опубликован …, предварительный — https://…
```

## get_github_release

### Вход

`owner`, `repo` — как выше; `tag: string` — точный тег релиза (`^[A-Za-z0-9._@/+-]{1,200}$` после trim),
например `v4.6.5`. Релиз по неточному или несуществующему тегу не подбирается.

### Запрос и результат

`GET https://api.github.com/repos/{owner}/{repo}/releases/tags/{encodeURIComponent(tag)}`. Текст:

```text
Релиз GitHub colinhacks/zod v4.6.5
Название: v4.6.5
Опубликован: 2026-09-13T23:25:34Z
Ссылка: https://github.com/colinhacks/zod/releases/tag/v4.6.5

Заметки к релизу:
<тело релиза после trim>
```

Заметки длиннее `MAX_RELEASE_NOTES_CHARS` (4000 символов) обрезаются с строкой
`[Заметки обрезаны: показано 4000 из N символов.]`. Пустое или отсутствующее тело даёт строку
«Заметки к релизу: отсутствуют (GitHub вернул пустое описание).».

## Заголовки запроса

Каждый запрос отправляет `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` и
`User-Agent: mcp-lab-github-releases` — без `User-Agent` GitHub отклоняет запрос. `Authorization` не
передаётся: сервер работает без токена.

## Ошибки

`REPOSITORY_NOT_FOUND` (404 у списка), `RELEASE_NOT_FOUND` (404 у тега), `RATE_LIMITED` (429 или 403 с
заголовком `x-ratelimit-remaining: 0`), `BAD_STATUS`, `NETWORK_FAILED`, `INVALID_PAYLOAD` (у релиза нет
`tag_name` или `html_url`). Различие 404 передаётся параметром stage в `src/github/request.ts`. Текст
`isError` не содержит тело ответа, URL и стек.

## Зависимости

Production: `@modelcontextprotocol/server@2.0.0`, `zod@4.5.4` (`zod/v4`). Dev-зависимость
`@modelcontextprotocol/client@2.0.0` — только для протокольных тестов на in-memory transport. `fetch`
передаётся через dependency injection; `process`, argv и env — только в `src/app/main.ts`. Таймаут —
именованная константа `GITHUB_API_TIMEOUT_MS` (8 с), меньше таймаута MCP host по умолчанию (10 с).

## Dev / build / start

```sh
npm run dev --workspace @mcp-lab/github-releases-server
npm run build
npm run start --workspace @mcp-lab/github-releases-server
```

## Подключение host

Host запускает `src/app/main.ts` (dev) или `dist/app/main.js` (после сборки) отдельным процессом по stdio
на каждый `ask`, где нужна проверка релизов npm-зависимости; см.
[apps/host/src/features/dependencies](../../apps/host/src/features/dependencies/README.md) и
[ADR 0007](../../docs/adr/0007-orchestration-mcp.md).

## Ограничения

Без resources/prompts/sampling, без Streamable HTTP, без reconnect и retries, без токена (лимит 60
запросов в час на IP). Релиз по версии подбирает вызывающий: сервер требует точный тег.

## Проверка

`src/tests/releases.test.ts` — URL, заголовки и `per_page`, фильтр черновиков, пустой список, каждый код
ошибки (включая оба варианта `RATE_LIMITED`). `src/tests/format.test.ts` — обрезка и пустые заметки,
формат строк списка. `src/tests/protocol.integration.test.ts` — настоящий `McpServer`/`Client` на
in-memory transport: два инструмента, успешные вызовы, отклонение некорректных `owner`/`repo`/`tag`
схемой MCP. `npm run check` из корня репозитория выполняет lint, typecheck, границы, структуру,
документацию, тесты с покрытием и сборку.
