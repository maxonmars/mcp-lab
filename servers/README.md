# MCP-серверы

Самостоятельные npm workspaces MCP-серверов. Каждый — отдельный package.json, README.md, AGENTS.md,
CLAUDE.md, src/index.ts, src/app/main.ts, tsconfig.build.json и собственные тесты.

- [`open-meteo`](open-meteo/README.md) — текущая погода по названию города через публичный
  Open‑Meteo API; инструмент `get_current_weather`, MCP v2, ревизия `2026-07-28`.

Host использует `open-meteo` как `ToolSource` на каждый `ask` и внешний пакет Filesystem MCP как
дочерний процесс discovery. Новые серверы добавляются по отдельному заданию.

Серверы не импортируют host и друг друга; host не импортирует исходники серверов. Для тестов
используются подменённые API и транспорт — реальные внешние API только в ручных демо.
При появлении сервера обновляются проверки его запуска в `tooling/build.ts`.
