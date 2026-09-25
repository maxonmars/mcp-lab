# Host

Рабочий пакет с агентом, интерфейсом CLI/REPL, native tool calling через собственные Open‑Meteo и scheduler
MCP-серверы, worker планировщика погоды и discovery локального Filesystem MCP. Одна реплика вызывает один
запрос к DeepSeek — или два, если модель решит вызвать MCP-инструмент; предыдущие реплики в запрос не включаются.

## Навигация

- `src/core` — Agent (с tool-calling циклом), ModelPort, ToolSource, AgentError, собственные тесты.
- `src/adapters/llm` — DeepSeek SDK, перевод tools/tool_calls и ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода, MCP-статус и ошибок через styleText.
- `src/app` — запуск, composition root, реестры, системная инструкция (system.md + промпты фич), маршрутизация
  инструментов двух серверов для `ask` и обработчики `outfit`, `scheduler run` / `scheduler summary`.
- `src/features/mcp` — discovery Filesystem MCP и `withStdioToolSource` для Open‑Meteo MCP.
- `src/features/scheduler` — worker планировщика: цикл, показатели, промпты и типизированный MCP-адаптер.
- `src/features/outfit` — пайплайн совета по одежде из трёх инструментов Open‑Meteo и фасад для Agent.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- ask "Вопрос"`, `npm run dev -- mcp tools`.
После сборки: `npm start -- help`. Для `ask`, `outfit` и `scheduler run` нужен LAB_LLM_API_KEY; `ask` запускает
сессии Open‑Meteo и scheduler MCP, `outfit <город...>` — одну сессию Open‑Meteo на три вызова, `scheduler run` — два постоянных соединения worker до Ctrl+C.
Скрипты читают корневой `.env`, если файл существует.
`mcp tools` и `scheduler summary <город|ID>` не создают модель и работают без ключа.

Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и дальнейшее развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
