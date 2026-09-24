# open-meteo MCP server

## Назначение

Самостоятельный MCP-сервер поверх публичного [Open‑Meteo](https://open-meteo.com/) API: получает
координаты города через geocoding и возвращает нормализованный снимок текущей погоды. Не хранит
состояние, не требует API-ключ и не импортирует host.

## Контракт инструмента

Ровно один инструмент — `get_current_weather`. Описание сообщает модели, что инструмент возвращает
текущую погоду по названию города и должен использоваться для актуальных данных, а не предположений.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.

### Вход

Один обязательный параметр:

- `location: string` — город и необязательная страна или регион, например `Новосибирск, Россия`.
  Обрезается по пробелам, от 2 до 100 символов.

### Выход

`structuredContent` и текстовый `content` с тем же смыслом:

- `location` — `name`, необязательные `admin1`/`country`/`countryCode`, `latitude`, `longitude`, `timezone`;
- `observedAt` — локальное время наблюдения (для показа);
- `observedAtUtc` — то же наблюдение в UTC, `YYYY-MM-DDTHH:MM:SSZ`; вычисляется из локального времени и
  `utc_offset_seconds` того же ответа Open‑Meteo, а без этого поля ответ считается некорректным;
- `condition` — `code` (WMO) и русское `description`;
- `temperature`, `apparentTemperature`, `relativeHumidity`, `precipitation`, `windSpeed`;
- `units` — единицы всех числовых полей выше.

Полный необработанный ответ Open‑Meteo не возвращается. Open‑Meteo обновляет текущие условия по 15-минутным
модельным данным, поэтому повторные запросы в пределах слота возвращают одно и то же `observedAtUtc`.

## Ошибки

Город не найден, сетевой сбой, не-2xx статус или некорректный payload geocoding/forecast — всё
возвращается как `isError: true` с точной по стадии, но безопасной формулировкой: без тела ответа,
query-параметров, стека и секретов. Неизвестный код погоды WMO честно называется неизвестным, а не
сопоставляется с ближайшим похожим состоянием.

## Зависимости

Production: `@modelcontextprotocol/server@2.0.0`, `zod@4.5.4` (используется `zod/v4`). Dev-зависимость
`@modelcontextprotocol/client@2.0.0` — только для протокольных тестов на in-memory transport.
`fetch` передаётся в API-клиент через dependency injection; `process`, argv и env — только в
`src/app/main.ts`. Таймаут Open‑Meteo операций — именованная константа `OPEN_METEO_TIMEOUT_MS`.

## Dev / build / start

```sh
npm run dev --workspace @mcp-lab/open-meteo-server
npm run build
npm run start --workspace @mcp-lab/open-meteo-server
```

Сборка (из корня репозитория) компилирует `src` в `dist` тем же общим workspace-циклом, что и host.

## Inspector

```sh
npx @modelcontextprotocol/inspector node src/app/main.ts
```

Inspector подключается по stdio, покажет `get_current_weather` с его input/output схемой и позволит
вызвать инструмент вручную.

## Пример ручного вызова

Через Inspector или любой MCP v2 client: `tools/call` с `{"location": "Новосибирск, Россия"}`.
Успешный ответ содержит короткий текст на русском и `structuredContent` с полями выше; при ошибке —
`isError: true` и текст вида «Место не найдено сервисом геокодирования Open-Meteo.».

## Подключение host

Необязательный флаг `--ignore-sigint` нужен процессу, которым владеет worker планировщика: Ctrl+C приходит
всей группе процессов терминала, а опрос должен завершиться и сохраниться.

Host запускает `src/app/main.ts` (dev) или `dist/app/main.js` (после сборки) отдельным процессом по
stdio, используя `@modelcontextprotocol/client@2.0.0` с `versionNegotiation.mode = "auto"`; сервер
отвечает в ревизии `2026-07-28`. Один вызов `ask` — одна сессия: новый Client, новый Transport,
закрытие в `finally`. Подробности — в [ADR 0003](../../docs/adr/0003-open-meteo-tool-calling.md) и
[документации фичи host/features/mcp](../../apps/host/src/features/mcp/README.md).

## Ограничения

Один инструмент, без resources/prompts/sampling, без Streamable HTTP, без reconnect и retries.
Таймаут Open‑Meteo операций фиксирован в коде, отдельной настройки host для него нет.

## Проверка

Юнит-тесты (`src/tests/*.test.ts`) используют подменённый `fetch` и не обращаются к сети: geocoding,
forecast, нормализация снимка, WMO-коды, ошибки на каждой стадии. Отдельный `src/tests/protocol.
integration.test.ts` поднимает настоящие `McpServer` и `Client` поверх in-memory transport с тем же
подменённым `fetch` и проверяет modern negotiation, схему, успешный и `isError` вызовы. Живой
Open‑Meteo используется только в ручном демо `docs/demos/open-meteo-tool.md` в корне репозитория и
требует сеть, но не API-ключ. `npm run check` из корня репозитория выполняет lint, typecheck, границы,
структуру, документацию, тесты с покрытием и сборку для всего монорепозитория.
