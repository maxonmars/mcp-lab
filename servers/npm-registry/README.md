# npm-registry MCP server

## Назначение

Самостоятельный MCP-сервер поверх публичного [npm registry](https://registry.npmjs.org/): по точному
имени пакета возвращает последнюю опубликованную версию (dist-tag `latest`), описание, лицензию,
домашнюю страницу и репозиторий GitHub, если он указан. Не импортирует host. Используется в сценарии
[«Проверка обновления зависимости»](../../docs/adr/0007-orchestration-mcp.md).

## get_npm_package

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.

### Вход

`name: string` — точное имя пакета npm, например `zod` или `@types/node`. Обрезается по пробелам,
1–214 символов, регулярное выражение `^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$` (формат имени
npm). Некорректное имя отклоняется MCP-схемой до сетевого запроса.

### Запрос

Один `GET https://registry.npmjs.org/<path>/latest` с `Accept: application/json`. Для scoped-имени
`@scope/pkg` путь — `@scope%2Fpkg`, иначе `encodeURIComponent(name)`. Таймаут — именованная константа
`NPM_REGISTRY_TIMEOUT_MS` (8 с), меньше таймаута MCP host по умолчанию (10 с): таймаут API возвращается
моделью как `isError`, а не обрывает MCP-вызов.

### Выход

`structuredContent` и текстовый `content` с тем же смыслом: `name`, `version`, необязательные
`description`, `license`, `homepage`, `repositoryUrl` (значение поля `repository` ответа как есть — строка
или `.url` объекта) и `repository` (`{ owner, repo }`), если репозиторий на GitHub. Текст построчно:

```text
Пакет npm: zod
Последняя версия (dist-tag latest): 4.6.5
Описание: …
Лицензия: MIT
Домашняя страница: https://zod.dev
Репозиторий: https://github.com/colinhacks/zod
GitHub: owner=colinhacks, repo=zod
```

Отсутствующие необязательные поля опускаются. Без GitHub последняя строка —
`GitHub: репозиторий не указан или размещён не на GitHub.`; строка `Репозиторий:` при этом печатается,
только если поле `repository` вообще присутствует в ответе registry.

### Распознавание репозитория (`src/registry/repository.ts`)

Разбирает формы `git+https://github.com/o/r.git`, `https://github.com/o/r`, `git://github.com/o/r.git`,
`git+ssh://git@github.com/o/r.git`, `git@github.com:o/r.git`, `github:o/r`, `o/r`. Для репозитория не на
GitHub (в том числе нераспознаваемого) `parseGithubRepository` возвращает `undefined`, а
`repositoryDisplayUrl` сохраняет исходный URL без префикса `git+`.

## Ошибки

`PACKAGE_NOT_FOUND` (404), `BAD_STATUS` (иной не-2xx), `NETWORK_FAILED` (сбой `fetch`, включая abort по
таймауту), `INVALID_PAYLOAD` (невалидный JSON или отсутствуют обязательные `name`/`version`). Текст
`isError` не содержит тело ответа, URL и стек.

## Зависимости

Production: `@modelcontextprotocol/server@2.0.0`, `zod@4.5.4` (`zod/v4`). Dev-зависимость
`@modelcontextprotocol/client@2.0.0` — только для протокольных тестов на in-memory transport. `fetch`
передаётся через dependency injection; `process`, argv и env — только в `src/app/main.ts`.

## Dev / build / start

```sh
npm run dev --workspace @mcp-lab/npm-registry-server
npm run build
npm run start --workspace @mcp-lab/npm-registry-server
```

## Подключение host

Host запускает `src/app/main.ts` (dev) или `dist/app/main.js` (после сборки) отдельным процессом по stdio
на каждый `ask`, где нужна проверка npm-зависимости; см.
[apps/host/src/features/dependencies](../../apps/host/src/features/dependencies/README.md) и
[ADR 0007](../../docs/adr/0007-orchestration-mcp.md).

## Ограничения

Без resources/prompts/sampling, без Streamable HTTP, без reconnect и retries. Не проверяет фактическую
установленную версию — только манифест, который читает фича host, и dist-tag `latest` registry.

## Проверка

`src/tests/package.test.ts` — URL и заголовок запроса для обычного и scoped-имени, разбор полного ответа
(включая `repository` строкой и объектом), все коды ошибок на подменённом `fetch`.
`src/tests/repository.test.ts` — таблица форм `repository` и нормализация URL. `src/tests/protocol.integration.test.ts` —
настоящий `McpServer`/`Client` на in-memory transport: modern negotiation, один инструмент с полной
input-схемой, успешный и `isError`-вызов, отклонение некорректного имени. `npm run check` из корня
репозитория выполняет lint, typecheck, границы, структуру, документацию, тесты с покрытием и сборку.
