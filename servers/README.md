# MCP-серверы

Самостоятельные npm workspaces MCP-серверов. Каждый — отдельный package.json, README.md, AGENTS.md,
CLAUDE.md, src/index.ts, src/app/main.ts, tsconfig.build.json и собственные тесты.

- [`open-meteo`](open-meteo/README.md) — текущая погода по названию города через публичный
  Open‑Meteo API; инструмент `get_current_weather`, MCP v2, ревизия `2026-07-28`.
- [`scheduler`](scheduler/README.md) — расписания погоды, результаты опросов и опубликованные сводки в SQLite;
  публичные инструменты `schedule_weather`, `get_weather_summary`, `cancel_weather_schedule` и отдельный режим
  `--worker` со служебными операциями (ADR 0004).

Host использует `open-meteo` и публичный режим `scheduler` как `ToolSource` на каждый `ask`; в `scheduler run`
worker держит постоянные соединения с `open-meteo` и `scheduler --worker`, а `scheduler summary` читает
публичный режим. Внешний пакет Filesystem MCP — дочерний процесс discovery. Новые серверы добавляются по
отдельному заданию.

Серверы не импортируют host и друг друга; host не импортирует исходники серверов. Для тестов
используются подменённые API и транспорт — реальные внешние API только в ручных демо.
При появлении сервера обновляются проверки его запуска в `tooling/build.ts`.
