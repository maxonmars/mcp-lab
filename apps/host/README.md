# Host

Рабочий пакет с агентом, интерфейсом CLI/REPL, native tool calling через собственные Open‑Meteo, scheduler,
npm-registry и github-releases MCP-серверы, worker планировщика погоды, ежедневная сводка через Agent и
discovery локального Filesystem MCP. Одна реплика вызывает один запрос к DeepSeek — или больше, если модель
решает вызывать MCP-инструменты до лимита раундов Agent (по умолчанию 1, в `ask` — до 6, ADR 0007): `ask`
делает до семи запросов к модели за реплику — по одному на каждый возможный раунд и финальный текстовый
ответ. Предыдущие реплики в запрос не включаются.

## Навигация

- `src/core` — Agent (с многораундовым tool-calling циклом), ModelPort, ToolSource, AgentError, собственные тесты.
- `src/adapters/llm` — DeepSeek SDK, перевод tools/tool_calls и ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода, MCP-статус и ошибок через styleText.
- `src/app` — запуск, composition root, реестры, системная инструкция (system.md + промпты фич), маршрутизация
  инструментов пяти серверов для `ask` и обработчики `outfit`, `scheduler run` / `scheduler summary`.
- `src/features/mcp` — discovery Filesystem MCP и `withStdioToolSource` для остальных серверов.
- `src/features/scheduler` — worker планировщика: цикл, показатели, промпты и типизированный MCP-адаптер.
- `src/features/outfit` — пайплайн совета по одежде из трёх инструментов Open‑Meteo и фасад для Agent.
- `src/features/dependencies` — проекция Filesystem MCP для проверки обновления npm-зависимости host.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- ask "Вопрос"`, `npm run dev -- mcp tools`.
После сборки: `npm start -- help`. Для `ask`, `outfit` и `scheduler run` нужен LAB_LLM_API_KEY; `ask` запускает
до пяти сессий (Open‑Meteo, scheduler, Filesystem, npm-registry, github-releases), `outfit <город...>` — одну
сессию Open‑Meteo на три вызова, `scheduler run` — два постоянных соединения worker до Ctrl+C.
Скрипты читают корневой `.env`, если файл существует.
`mcp tools` и `scheduler summary <город|ID>` не создают модель и работают без ключа.

Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и дальнейшее развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
