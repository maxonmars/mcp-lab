# Host

Рабочий пакет с агентом, интерфейсом CLI/REPL, native tool calling через собственный Open‑Meteo MCP и
discovery локального Filesystem MCP. Одна реплика вызывает один запрос к DeepSeek — или два, если
модель решит вызвать `get_current_weather`; предыдущие реплики в запрос не включаются.

## Навигация

- `src/core` — Agent (с tool-calling циклом), ModelPort, ToolSource, AgentError, собственные тесты.
- `src/adapters/llm` — DeepSeek SDK, перевод tools/tool_calls и ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода, MCP-статус и ошибок через styleText.
- `src/app` — запуск, composition root, реестры и системная инструкция (system.md + feature prompt).
- `src/features/mcp` — discovery Filesystem MCP и `withStdioToolSource` для Open‑Meteo MCP.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- ask "Вопрос"`, `npm run dev -- mcp tools`.
После сборки: `npm start -- help`. Для `ask` нужен LAB_LLM_API_KEY — он же запускает Open‑Meteo MCP-сессию.
Скрипты читают корневой `.env`, если файл существует.
`mcp tools` не создаёт модель и работает без ключа; Open‑Meteo MCP запускается только внутри `ask`.

Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и дальнейшее развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
