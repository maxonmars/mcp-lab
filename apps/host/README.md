# Host

Первый работающий пакет: простой агент и интерфейс CLI/REPL.
Одна реплика вызывает один запрос к DeepSeek; предыдущие реплики в запрос не включаются.

## Навигация

- `src/core` — Agent, ModelPort, AgentError, собственные тесты.
- `src/adapters/llm` — SDK, перевод ответа и ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и отображение ошибок.
- `src/app` — запуск, composition root, реестры и системная инструкция.
- `src/features` — место будущих вертикальных фич; сейчас фич нет.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- ask "Вопрос"`.
После сборки: `npm start -- help`. Для обращения к модели нужен LAB_LLM_API_KEY.

Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и дальнейшее развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
