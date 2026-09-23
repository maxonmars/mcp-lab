# open-meteo MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md).

- Самостоятельный npm workspace `@mcp-lab/open-meteo-server`. Не импортирует host и другие серверы.
- Регистрирует ровно один инструмент `get_current_weather` поверх публичного Open‑Meteo API.
- `process`, argv и env доступны только в `src/app/main.ts`; API-клиент получает `fetch` через DI.
- stdout — только MCP protocol; любой лог — только stderr.
- `src/index.ts` экспортирует только factory сервера и типы, нужные тестам и host.
- Таймаут Open‑Meteo операций — именованная константа, не магическое число в потоке запроса.
- Ошибки geocoding и forecast не содержат тело ответа, query и стек; только код причины.
- Тесты используют подменённый `fetch`, без обращения к настоящему Open‑Meteo.
