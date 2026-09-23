# MCP: Filesystem discovery и Open‑Meteo tool calling

## Назначение

Фича объединяет два независимых MCP-сценария под общим index.ts:

- `discoverFilesystemTools` запускает локальный Filesystem MCP по stdio, получает сведения о сервере
  и список его инструментов, закрывает соединение. Не вызывает инструменты и не обращается к модели.
- `withStdioToolSource` запускает собственный Open‑Meteo MCP-сервер (`servers/open-meteo`) по stdio на
  каждый вызов и передаёт `ToolSource` (`listTools`/`callTool`) в callback; используется `Agent.respond()`
  для native tool calling.

## Публичный контракт

`discoverFilesystemTools(options)` принимает абсолютный `root`, таймаут MCP-запросов и путь к
исполняемому Node. Возвращаются только имя и версия, сообщённые MCP-сервером, а также имена и
неизменённые описания инструментов. `McpDiscoveryError` содержит код причины; у `TIMEOUT` есть `stage`:
`connect` или `listTools`.

`withStdioToolSource(options, use)` принимает `command`, `args` и `timeoutMs`, создаёт Client и
Transport, договаривается о современной ревизии (`versionNegotiation.mode = "auto"`), проверяет
capability tools и передаёт `use` объект `ToolSource` из core: `listTools()` возвращает полные
`ToolDefinition` (включая `inputSchema`), `callTool()` — `ToolResult` с объединённым текстом и `isError`.
Client закрывается в `finally`; ошибка из `use` (например, `AgentError`) проходит наружу без изменений.
`McpToolSourceError` — отдельный тип ошибки со своими кодами и `stage` для `TIMEOUT`
(`connect`/`listTools`/`callTool`).

`resolveOpenMeteoEntrypoint(hostModuleUrl)` вычисляет абсолютный путь к `servers/open-meteo/src/app/
main.ts` или `dist/app/main.js` по расширению переданного `import.meta.url` — явно и тестируемо, без
обращения к cwd.

Пользовательский текст формирует CLI.

## Настройки и команда

Composition root передаёт `mcp.filesystemRoot` и `mcp.timeoutMs` в `discoverFilesystemTools`; тот же
`mcp.timeoutMs` переиспользуется для connect/listTools/callTool в `withStdioToolSource`. Команда
host — `mcp tools` (только Filesystem); в REPL ей соответствует `/mcp tools`. Open‑Meteo MCP отдельной
командой не управляется — сессия создаётся и закрывается внутри `ask`.

## Ограничения

Для каждого вызова создаётся новое соединение — постоянной сессии, кэша и переподключения нет.
Filesystem discovery использует legacy-ревизию `2025-11-25`, Open‑Meteo — современную `2026-07-28`; это
намеренное различие двух жизненных циклов, а не непоследовательность. Максимум один tool call за
реплику обеспечивает Agent, не эта фича. Roots, resources, prompts, sampling и агрегатор нескольких
MCP-серверов в эту фичу не входят.

## Проверка

Тесты discovery проверяют успешный и ошибочные жизненные циклы через подмену SDK; отдельный
интеграционный тест запускает установленный Filesystem-сервер. Тесты `toolSource.test.ts` проверяют
modern negotiation, listTools/callTool, объединение text blocks, `isError`, различие таймаутов по
стадиям и порядок close/primary failure — тем же способом подмены SDK. Отдельный
`openMeteo.integration.test.ts` запускает настоящий `servers/open-meteo` процесс, получает список
инструментов без обращения к внешнему Open‑Meteo и проверяет завершение дочернего процесса. Полная
проверка проекта: `npm run check`.
