# open-meteo MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md).

- Самостоятельный npm workspace `@mcp-lab/open-meteo-server`. Не импортирует host и другие серверы.
- Обычный режим регистрирует только `get_current_weather`; `--outfit-report-file <абсолютный путь>` добавляет
  `recommend_outfit` и `save_outfit_advice` (ADR 0005). Worker планировщика использует обычный режим.
- Без `includeNextHours` запрос к API, текст и `structuredContent` `get_current_weather` не меняются.
- Параметры DeepSeek читаются из `LAB_LLM_*` только в `main.ts`; функция генерации внедряется в фабрику.
- Путь файла совета задаётся только при запуске; MCP-аргументы путь не содержат. Запись — временный файл + rename.
- `observedAtUtc` строится из `utc_offset_seconds` ответа API; локальное `observedAt` не трактуется как UTC.
- `process`, argv и env доступны только в `src/app/main.ts`; API-клиент получает `fetch` через DI.
- stdout — только MCP protocol; любой лог — только stderr.
- `src/index.ts` экспортирует factory сервера, адаптер DeepSeek для `main.ts`, имена инструментов и типы.
- Таймаут Open‑Meteo операций — именованная константа, не магическое число в потоке запроса.
- Ошибки geocoding, forecast и модели не содержат тело ответа, query, ключ и стек; только код причины.
- Тесты используют подменённые `fetch`, часы и генерацию совета, без настоящих Open‑Meteo и DeepSeek.
