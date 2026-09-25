# Совет по одежде: пайплайн трёх MCP-инструментов

## Назначение

По городу получает текущую погоду с прогнозом на три почасовых интервала, составляет совет по одежде и
сохраняет его в `.local/outfit/latest.md`. Все три инструмента принадлежат серверу `servers/open-meteo`
в outfit-режиме и вызываются последовательно через один `ToolSource`, то есть одну MCP-сессию:
`get_current_weather → recommend_outfit → save_outfit_advice`. Решение — в
[ADR 0005](../../../../../docs/adr/0005-outfit-pipeline.md).

## Публичный контракт (`index.ts`)

- `runOutfitPipeline(source, location)` — проверяет город, вызывает три инструмента по порядку и возвращает
  `{ location, markdown }`. Аргументы шагов: `{ location, includeNextHours: true }`, `{ weatherText }`,
  `{ markdown }`; тексты передаются дальше без изменений. После каждого шага проверяются `isError` и
  непустой текст; ошибка погоды или совета останавливает цепочку до сохранения.
- `requireOutfitLocation(city)` — те же границы, что у `location` сервера (2–100 символов после trim).
- `outfitToolSource(source, { reportPath })` — проекция полного источника Open‑Meteo для Agent: скрывает
  `recommend_outfit` и `save_outfit_advice`, запрещает их прямой вызов (`OutfitError` `HIDDEN_TOOL`) и
  добавляет фасад `prepare_outfit_advice({ location })`, который вызывает тот же runner. Фасад объявляется,
  только если источник предоставляет все три инструмента. Ошибка пайплайна возвращается модели как
  `isError`-результат с текстом `describeOutfitError`.
- `outfitServerOptions(config)` — параметры stdio-запуска: `--outfit-report-file <абсолютный путь>`,
  `LAB_LLM_*` в `env` и таймауты вызова по имени инструмента.
- `OutfitError` (`INVALID_LOCATION`, `STEP_FAILED`, `EMPTY_RESULT`, `CALL_FAILED`, `HIDDEN_TOOL`) с полем
  `step` (`weather`, `recommend`, `save`); у `CALL_FAILED` исходная ошибка транспорта — в `cause`.
- `OUTFIT_REPORT_FILE`, `PREPARE_OUTFIT_ADVICE`, `prompts/outfitTool.md` — инструкция модели для `ask`.

## Настройки и команды

Новых настроек нет. Путь `latest.md` вычисляет host от рабочего каталога; модель и MCP-аргументы его
не задают. Таймауты: подключение, список и `save_outfit_advice` — `mcp.timeoutMs`; `get_current_weather` —
`3 × mcp.timeoutMs` (геокодирование, текущая погода и прогноз идут последовательно); `recommend_outfit` —
`llm.timeoutMs + mcp.timeoutMs`. Серверу передаются действующие `llm.model`, `llm.timeoutMs`,
`llm.maxOutputTokens` и ключ.

- `outfit <город...>` (`/outfit` в REPL) — гарантированно запускает цепочку, печатает три строки
  `MCP: …`, совет и путь файла; ошибка — код выхода 1.
- `ask` — Agent видит `get_current_weather`, инструменты планировщика и фасад. Статусы `MCP:` печатаются для
  реальных вызовов сервера, фасад строки не порождает.

## Ограничения

Совет рассчитан на выход сейчас примерно на 2–3 часа и не учитывает гардероб, профиль и историю. В `ask`
выбор фасада делает модель; гарантированный порядок даёт команда. Лимит одного tool call за реплику по-прежнему
держит Agent: фасад — один вызов с его точки зрения. Фича не импортирует `mcp` и `scheduler`; запуск процесса
выполняет composition root через `withStdioToolSource`.

## Проверка

`tests/runner.test.ts` — порядок и аргументы трёх вызовов, дословная передача текстов, остановка после ошибки и
пустого результата каждого шага, проверка города до вызовов. `tests/facade.test.ts` — скрытие внутренних шагов,
запрет прямого вызова, фасад в `Agent` с fake `ModelPort`, параметры запуска сервера. Сценарии команды и `ask`
через composition root — в `app/tests/outfit.test.ts`. Ручное демо — [docs/demos/outfit.md](../../../../../docs/demos/outfit.md).
