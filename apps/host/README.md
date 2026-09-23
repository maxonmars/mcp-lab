# Host

Рабочий пакет с простым агентом, интерфейсом CLI/REPL и discovery локального Filesystem MCP.
Одна реплика вызывает один запрос к DeepSeek; предыдущие реплики в запрос не включаются.

## Навигация

- `src/core` — Agent, ModelPort, AgentError, собственные тесты.
- `src/adapters/llm` — SDK, перевод ответа и ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода и ошибок через styleText.
- `src/app` — запуск, composition root, реестры и системная инструкция.
- `src/features/mcp` — получение списка инструментов Filesystem MCP по stdio.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- ask "Вопрос"`, `npm run dev -- mcp tools`.
После сборки: `npm start -- help`. Для обращения к модели нужен LAB_LLM_API_KEY.
Скрипты читают корневой `.env`, если файл существует.
`mcp tools` не создаёт модель и работает без ключа.

Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и дальнейшее развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
