# 0003 — Native tool calling через собственный Open‑Meteo MCP

Статус: принято для первого собственного MCP-сервера и первого выполнения инструмента.
Дата: 2026-09-23.

## Контекст

Учебная цель — провести полный цикл `ask → tool_calls → MCP → финальный ответ`: DeepSeek сам
выбирает инструмент через native tool calling, Agent вызывает его через MCP, а не напрямую, и
возвращает результат модели для итогового ответа. ADR 0002 сознательно оставил выполнение
инструментов, их схемы в модели и общий источник инструментов вне объёма — этот ADR закрывает
именно их для одного инструмента `get_current_weather` поверх публичного Open‑Meteo API.

## Почему одного нового MCP server недостаточно

Filesystem discovery лишь получает список инструментов и не передаёт его модели. Чтобы DeepSeek
сам выбрал инструмент, а Agent выполнил вызов и вернул результат в диалог, нужны: провайдер-нейтральный
контракт tool calling в ядре, цикл вызова в Agent, перевод этого контракта в DeepSeek-совместимый wire
формат и MCP-клиент, умеющий не только `listTools`, но и `callTool`. Новый сервер сам по себе не
закрывает ни один из этих пунктов.

## Почему требуется изменение ModelPort

Старый `ModelPort.complete(messages): Promise<string>` не может выразить `tools`, `tool_choice` и
структурированный `tool_calls` ответ модели. Это намеренное изменение публичного контракта версии
`0.1.0`: `complete(request: ModelRequest): Promise<ModelCompletion>`, где `ModelCompletion` — размеченное
объединение `text` и `tool_calls`. Совместимость через overload не вводится: она усложнила бы Agent и
DeepSeek adapter ради временного моста, которым никто не воспользуется.

## Почему tool loop находится в Agent, а не внутри DeepSeek adapter

Adapter отвечает только за формат конкретного провайдера. Решение о том, сколько раз вызывать
инструмент, какие сообщения собрать во второй запрос и как обработать `isError`, — часть протокола
диалога модели с инструментами, а не деталь DeepSeek. Если завтра появится второй провайдер, цикл не
должен дублироваться в каждом adapter.

## Provider-neutral ToolSource

`ToolSource` (`listTools`/`callTool`) и типы `ToolDefinition`, `ToolCall`, `ToolInvocation`, `ToolResult`
живут в core без SDK, Node API и MCP-типов. Agent получает `ToolSource` как необязательный параметр
`respond()`, а не через конструктор: он не хранится между репликами, как и модель не хранит историю.

## Отдельный server workspace

`servers/open-meteo` — самостоятельный npm workspace без импорта host, зеркалящий структуру, уже
согласованную для `servers/*` в ADR 0001. API-клиент получает `fetch` через dependency injection;
`process`, argv и env — только в `src/app/main.ts`.

## Stdio transport, MCP v2, ревизия 2026‑07‑28

Новый сервер и host-клиент к нему используют `@modelcontextprotocol/server@2.0.0` и
`@modelcontextprotocol/client@2.0.0` поверх stdio, как и Filesystem discovery. В отличие от неё
соединение договаривается о современной ревизии: `versionNegotiation.mode = "auto"` на клиенте
пробует `server/discover` и переходит на современную эру, которую подтверждает сервер этой версии SDK
(2026‑07‑28). Ревизия закрепляется вручную проверкой протокольного integration-теста, а не строкой в
конфигурации: другого способа зафиксировать фактически согласованную ревизию у modern-negotiation нет.

## Одна сессия на ask, максимум один tool call, без истории и retries

Каждый `ask` создаёт новый stdio-процесс, новый Client и новый Transport и закрывает их в `finally` —
как и Filesystem discovery, но теперь ещё и с `callTool`. Agent допускает не более одного tool call за
реплику (`MAX_TOOL_CALLS_PER_TURN`) и делает ровно один добавочный запрос модели после результата;
повторный tool call во втором ответе — ошибка лимита, а не цикл. Reconnect и retries не добавляются:
транспортная ошибка завершает turn типизированной ошибкой, как раньше делала discovery.

## Передача isError модели

`ToolResult.isError` не превращается в исключение Agent: безопасный `content` результата (в том числе
текст ошибки Open‑Meteo API) добавляется как обычное tool-сообщение, и второй запрос модели всё равно
выполняется — модель формулирует объяснение пользователю сама, а не получает решение за неё.

## Сохранение Filesystem discovery

`discoverFilesystemTools`, её ошибки и поведение `mcp tools` не меняются. Новая операция
`withStdioToolSource` и её ошибка `McpToolSourceError` — отдельные модули фичи `mcp`, не расширяющие
`McpDiscoveryError`: у Filesystem discovery и tool calling разные жизненные циклы и разные причины
отказа.

## Короткое пользовательское MCP-событие

Перед финальным ответом печатается одна строка `MCP: get_current_weather — выполнено` либо
`— ошибка`, без аргументов, location и содержимого результата. Она формируется в composition root
как наблюдение над вызовом `ToolSource.callTool`, а не внутри core или CLI adapter, чтобы Agent и
CliView остались независимы от факта существования этой строки.

## Последствия

Agent и ModelPort перестают быть текстовым API «только для DeepSeek»: любой будущий провайдер обязан
поддержать `ModelRequest`/`ModelCompletion`. Пользователь `ask` получает реальные данные инструмента,
но ценой одного дополнительного процесса и одного дополнительного запроса модели на реплику, если
DeepSeek решит вызвать инструмент. История диалога, несколько инструментов, несколько раундов вызова,
Streamable HTTP и агрегатор нескольких MCP-серверов остаются вне объёма и не должны появляться попутно.

## Проверка

Core-тесты Agent проверяют цикл без сети через fake ModelPort и fake ToolSource: ровно один tool call,
содержимое второго запроса, обработку `isError`, лимит и независимость соседних `respond()`. DeepSeek
adapter-тесты проверяют точные JSON-тела запросов и разбор `finish_reason: tool_calls` через
подменённый fetch. Server-тесты Open‑Meteo используют подменённый `fetch` для geocoding и forecast.
Отдельный офлайн протокольный integration-тест поднимает настоящие MCP v2 Client и Server поверх
in-memory transport и проверяет modern negotiation, схему, `callTool` и `isError`; ещё один тест
запускает настоящий `servers/open-meteo` server-процесс по stdio без обращения к Open‑Meteo. Ручное
демо в `docs/demos/open-meteo-tool.md` использует настоящий Open‑Meteo и реальный ключ DeepSeek.
