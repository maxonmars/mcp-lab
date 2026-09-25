# open-meteo MCP server

## Назначение

Самостоятельный MCP-сервер поверх публичного [Open‑Meteo](https://open-meteo.com/) API: получает
координаты города через geocoding и возвращает нормализованный снимок текущей погоды, по запросу — с
прогнозом на три ближайших часа. Не импортирует host.

## Режимы

- Обычный запуск регистрирует только `get_current_weather`, не требует API-ключа и не пишет файлы.
  Этот режим использует worker планировщика.
- `--outfit-report-file <абсолютный путь>` дополнительно регистрирует `recommend_outfit` и
  `save_outfit_advice` ([ADR 0005](../../docs/adr/0005-outfit-pipeline.md)). Параметры DeepSeek читаются из
  окружения процесса: `LAB_LLM_API_KEY`, `LAB_LLM_MODEL`, `LAB_LLM_TIMEOUT_MS`, `LAB_LLM_MAX_OUTPUT_TOKENS`.
  Без них или с относительным путём процесс завершается с кодом 2 и сообщением в stderr. Единственное
  состояние сервера — этот файл; каталог создаётся только при сохранении.

## get_current_weather

Описание сообщает модели, что инструмент возвращает текущую погоду по названию города и должен
использоваться для актуальных данных, а не предположений.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`.

### Вход

- `location: string` — город и необязательная страна или регион, например `Новосибирск, Россия`.
  Обрезается по пробелам, от 2 до 100 символов.
- `includeNextHours?: boolean` — добавить прогноз на три будущих почасовых интервала. Без него запрос к
  API, текст и `structuredContent` прежние.

### Выход

`structuredContent` и текстовый `content` с тем же смыслом:

- `location` — `name`, необязательные `admin1`/`country`/`countryCode`, `latitude`, `longitude`, `timezone`;
- `observedAt` — локальное время наблюдения (для показа);
- `observedAtUtc` — то же наблюдение в UTC, `YYYY-MM-DDTHH:MM:SSZ`; вычисляется из локального времени и
  `utc_offset_seconds` того же ответа Open‑Meteo, а без этого поля ответ считается некорректным;
- `condition` — `code` (WMO) и русское `description`;
- `temperature`, `apparentTemperature`, `relativeHumidity`, `precipitation`, `windSpeed`;
- `units` — единицы всех числовых полей выше;
- `nextHours` — только при `includeNextHours: true`, ровно три элемента: `time` (местное время города),
  `timeUtc`, `condition`, `temperature`, `apparentTemperature`, `windSpeed` — на момент отметки;
  `precipitationLastHour` и необязательная `precipitationProbabilityLastHour` — за час перед отметкой.
  Текст подписывает это различие. Недоступная вероятность осадков опускается, в тексте — «нет данных».

Полный необработанный ответ Open‑Meteo не возвращается. Open‑Meteo обновляет текущие условия по 15-минутным
модельным данным, поэтому повторные запросы в пределах слота возвращают одно и то же `observedAtUtc`.

Прогноз — отдельный запрос после текущей погоды с координатами уже найденного места:
`hourly=temperature_2m,apparent_temperature,wind_speed_10m,weather_code,precipitation,precipitation_probability`,
`forecast_hours=5`, `timeformat=unixtime`. Первая отметка ответа — начало текущего часа; выбираются три
первые отметки строго позже текущего времени и `observedAtUtc` (сравнение в UTC, часы внедряются через
`now`). Длины массивов, возрастание времени и обязательные значения выбранных отметок проверяются.

## recommend_outfit

Вход `{ weatherText }` — текст результата `get_current_weather` без изменений. Один запрос к DeepSeek
(`maxRetries: 0`, reasoning отключён) с инструкцией из `src/outfit/prompts/outfitAdvice.md`: одежда,
обувь, что взять с собой и объяснение по данным; прогноз вероятностный, совет — на выход сейчас,
переносимость холода неизвестна. Выход `{ markdown }`: заголовок, совет модели и раздел с исходным
`weatherText`. Пустой ответ, `finish_reason` не `stop` или сбой провайдера — `isError: true` с безопасной
причиной (только HTTP-статус, без тела ответа и ключа).

## save_outfit_advice

Вход `{ markdown }`, выход `{ path }`. Текст записывается без изменений в файл из `--outfit-report-file`:
временный файл рядом с целью и `rename`, при ошибке временный файл удаляется. Повторное сохранение
заменяет прежний совет.

## Ошибки

Город не найден, сетевой сбой, не-2xx статус или некорректный payload geocoding, текущей погоды и
почасового прогноза, а также неполный прогноз — всё возвращается как `isError: true` с точной по стадии, но безопасной формулировкой: без тела ответа,
query-параметров, стека и секретов. Неизвестный код погоды WMO честно называется неизвестным, а не
сопоставляется с ближайшим похожим состоянием.

## Зависимости

Production: `@modelcontextprotocol/server@2.0.0`, `openai@7.10.0` (OpenAI-совместимый клиент DeepSeek только
для `recommend_outfit`), `zod@4.5.4` (используется `zod/v4`). Dev-зависимость
`@modelcontextprotocol/client@2.0.0` — только для протокольных тестов на in-memory transport.
`fetch`, часы и функция генерации совета передаются через dependency injection; `process`, argv и env —
только в `src/app/main.ts`. Таймаут Open‑Meteo операций — именованная константа `OPEN_METEO_TIMEOUT_MS`.

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
вызвать инструмент вручную. Для outfit-режима добавьте `--outfit-report-file` с абсолютным путём и
переменные `LAB_LLM_*` в окружение Inspector.

## Пример ручного вызова

Через Inspector или любой MCP v2 client: `tools/call` с `{"location": "Новосибирск, Россия"}`.
Успешный ответ содержит короткий текст на русском и `structuredContent` с полями выше; при ошибке —
`isError: true` и текст вида «Место не найдено сервисом геокодирования Open-Meteo.».

## Подключение host

Необязательный флаг `--ignore-sigint` нужен процессу, которым владеет worker планировщика: Ctrl+C приходит
всей группе процессов терминала, а опрос должен завершиться и сохраниться.

Host запускает `src/app/main.ts` (dev) или `dist/app/main.js` (после сборки) отдельным процессом по
stdio, используя `@modelcontextprotocol/client@2.0.0` с `versionNegotiation.mode = "auto"`; сервер
отвечает в ревизии `2026-07-28`. Один вызов `ask` или `outfit` — одна сессия в outfit-режиме: новый
Client, новый Transport, закрытие в `finally`; ключ и параметры DeepSeek host передаёт через `env`. Подробности — в [ADR 0003](../../docs/adr/0003-open-meteo-tool-calling.md) и
[документации фичи host/features/mcp](../../apps/host/src/features/mcp/README.md).

## Ограничения

Без resources/prompts/sampling, без Streamable HTTP, без reconnect и retries. Таймаут Open‑Meteo операций
фиксирован в коде, отдельной настройки host для него нет. Совет не учитывает гардероб и историю.

## Проверка

Юнит-тесты (`src/tests/*.test.ts`) используют подменённые `fetch`, часы и `fetch` DeepSeek и не обращаются
к сети: geocoding, forecast, почасовой прогноз (выбор интервалов, полночь, неверные массивы, неполный
прогноз), нормализация снимка, WMO-коды, адаптер модели (один запрос без повторов). Протокольные тесты
поднимают настоящие `McpServer` и `Client` поверх in-memory transport: modern negotiation, один инструмент
в обычном режиме и три в outfit-режиме, цепочка с дословной передачей, запись и замена файла, отсутствие
временного файла после отказа. Живые
Open‑Meteo и DeepSeek используются только в ручных демо `docs/demos/open-meteo-tool.md` (сеть, без ключа
Open‑Meteo) и `docs/demos/outfit.md` (сеть и `LAB_LLM_API_KEY`). `npm run check` из корня репозитория выполняет lint, typecheck, границы,
структуру, документацию, тесты с покрытием и сборку для всего монорепозитория.
