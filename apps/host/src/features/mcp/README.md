# MCP: Filesystem discovery и общий stdio tool calling

## Назначение

Фича объединяет два независимых MCP-сценария под общим index.ts:

- `discoverFilesystemTools` запускает локальный Filesystem MCP по stdio в legacy-режиме, получает сведения
  о сервере и список его инструментов, закрывает соединение. Не вызывает инструменты и не обращается к модели.
- `withStdioToolSource` — общая, сервер-нейтральная операция: запускает любой MCP-сервер по stdio на
  каждый вызов и передаёт `ToolSource` (`listTools`/`callTool`) в callback; используется `Agent.respond()`
  для native tool calling. Composition root применяет её к пяти серверам: Open‑Meteo, scheduler, Filesystem
  (современная ревизия, в отличие от `discoverFilesystemTools`), npm-registry и github-releases (ADR 0007).

## Публичный контракт

`discoverFilesystemTools(options)` принимает абсолютный `root`, таймаут MCP-запросов и путь к
исполняемому Node. Возвращаются только имя и версия, сообщённые MCP-сервером, а также имена и
неизменённые описания инструментов. `McpDiscoveryError` содержит код причины; у `TIMEOUT` есть `stage`:
`connect` или `listTools`.

`withStdioToolSource(options, use)` принимает `command`, `args`, обязательный `serverName` (метка для
строк `MCP:` и ошибок), `timeoutMs`, необязательные `env` и `callTimeoutsMs` (таймаут `callTool` по имени
инструмента), создаёт Client и Transport, договаривается о современной ревизии (`versionNegotiation.mode =
"auto"`), проверяет capability tools и передаёт `use` объект `ToolSource` из core: `listTools()` возвращает
полные `ToolDefinition` (включая `inputSchema`), `callTool()` — `ToolResult` с объединённым текстом и
`isError`. Client закрывается в `finally`; ошибка из `use` (например, `AgentError`) проходит наружу без
изменений. `env` добавляется к безопасному набору переменных MCP SDK (`HOME`, `PATH` и т. п.); остальное
окружение host дочерний процесс не получает.
`McpToolSourceError` — отдельный тип ошибки со своими кодами, обязательным `server` и `stage` для
`TIMEOUT` (`connect`/`listTools`/`callTool`); `server` задаётся там, где создаётся ошибка, и не
перемаркируется в `catch` обёрток вложенных сессий.

`resolveOpenMeteoEntrypoint(hostModuleUrl)` вычисляет абсолютный путь к `servers/open-meteo/src/app/
main.ts` или `dist/app/main.js` по расширению переданного `import.meta.url` — явно и тестируемо, без
обращения к cwd. `resolveFilesystemEntrypoint()` резолвит путь к установленному пакету
`@modelcontextprotocol/server-filesystem` через `package.json` host; используется и
`discoverFilesystemTools`, и composition root для современной Filesystem-сессии `ask`.

Пользовательский текст формирует CLI.

## Настройки и команда

Composition root передаёт `mcp.filesystemRoot` и `mcp.timeoutMs` в `discoverFilesystemTools`; тот же
`mcp.timeoutMs` — таймаут connect/listTools и вызовов без отдельного значения в `withStdioToolSource`.
Увеличенные таймауты шагов совета по одежде задаёт фича `outfit`. Команда host — `mcp tools` (только
Filesystem, legacy-режим); в REPL ей соответствует `/mcp tools`. Сессии `ask` (все пять серверов, включая
современную Filesystem-сессию) создаются и закрываются внутри `ask`; `outfit` открывает свою сессию
Open‑Meteo так же.

## Ограничения

Для каждого вызова создаётся новое соединение — постоянной сессии, кэша и переподключения нет.
Filesystem discovery использует legacy-ревизию `2025-11-25`, `withStdioToolSource` — современную
`2026-07-28`; это намеренное различие двух жизненных циклов, а не непоследовательность. Лимит вызовов за
реплику обеспечивает Agent (`AgentOptions.maxToolCalls`), не эта фича. Roots, resources, prompts, sampling
и агрегатор нескольких MCP-серверов с политиками в эту фичу не входят.

## Проверка

Тесты discovery проверяют успешный и ошибочные жизненные циклы через подмену SDK; отдельный
интеграционный тест запускает установленный Filesystem-сервер. Тесты `toolSource.test.ts` проверяют
modern negotiation, listTools/callTool, объединение text blocks, `isError`, различие таймаутов по
стадиям, таймауты по имени инструмента, передачу `env`, `server` в ошибках и порядок close/primary
failure — тем же способом подмены SDK. Отдельный `openMeteo.integration.test.ts` запускает настоящий
`servers/open-meteo` процесс, получает список инструментов в обычном и outfit-режиме без обращения к
Open‑Meteo и DeepSeek и проверяет завершение дочернего процесса. `app/tests/dependencyFiles.integration.
test.ts` проверяет `withStdioToolSource` поверх настоящего Filesystem-сервера в современном режиме. Полная
проверка проекта: `npm run check`.
