# mcp-lab

Учебный host на TypeScript и Node 24: CLI-агент с native tool calling через собственные MCP-серверы
(Open‑Meteo и планировщик погоды), фоновый worker планировщика и подключение к локальному Filesystem MCP.
Агент отправляет системную инструкцию и текущую реплику в DeepSeek; между репликами история не сохраняется.
DeepSeek сам решает вызвать MCP-инструмент (`get_current_weather`, `schedule_weather`, `get_weather_summary`,
`cancel_weather_schedule`) или фасад совета по одежде, не более одного вызова за реплику. Команда `outfit`
выполняет цепочку из трёх MCP-инструментов Open‑Meteo и сохраняет совет в `.local/outfit/latest.md`.

## Запуск

```sh
nvm use
npm ci
npm run hooks:install
cp .env.example .env
npm run dev
```

Укажите ключ в корневом `.env`:

```dotenv
LAB_LLM_API_KEY=ваш-ключ
```

В REPL обычная строка отправляется агенту. `/help` показывает команды, `/exit` завершает ввод.
Каждая строка — независимый вопрос. EOF также завершает CLI.
Ошибки выводятся в stderr; после ошибки REPL можно продолжать, итоговый код процесса остаётся 1.

```sh
npm run dev -- ask "Что такое MCP? Ответь кратко."
npm run dev -- ask "Какая сейчас погода в Новосибирске?"
npm run dev -- ask "Что надеть в Новосибирске, если выхожу на пару часов?"
npm run dev -- outfit Новосибирск
npm run dev -- help
npm run dev -- config show
npm run dev -- mcp tools
npm run dev -- scheduler run
npm run dev -- scheduler summary Новосибирск
```

Справка, просмотр настроек, `mcp tools` и `scheduler summary` работают без ключа. `mcp tools` получает список от
настоящего локального Filesystem-сервера, но не вызывает инструменты и не обращается к модели. `ask`, `outfit` и
`scheduler run` требуют ключ: на каждый `ask` host запускает собственные Open‑Meteo и scheduler MCP-серверы по
stdio и закрывает сессии после ответа; если DeepSeek решит вызвать инструмент, перед ответом печатается одна
строка `MCP: <имя инструмента> — выполнено` (или `— ошибка`).
`npm run dev` и `npm start` читают корневой `.env`, если он существует. Переменная, переданная
окружением процесса, имеет приоритет. Значение секрета не выводится в config show.

## Планировщик погоды

Терминал A запускает worker и занимает терминал до Ctrl+C: он опрашивает Open‑Meteo через MCP, пишет каждый
опрос в SQLite и по своему сроку печатает сводку, написанную моделью. Терминал B создаёт расписание через `ask`
и читает сводку.

```sh
npm run dev -- scheduler run            # терминал A, нужен LAB_LLM_API_KEY
npm run dev -- ask "Проверяй погоду в Новосибирске каждые 10 секунд, выводи сводку раз в минуту"   # терминал B
npm run dev -- scheduler summary Новосибирск   # без модели и без ключа
```

Состояние — `.local/scheduler.sqlite`, копии последних сводок — `.local/reports/<ID>.md` (пути задают
`scheduler.dbPath` и `scheduler.reportsDir`). Источник истины для чтения — SQLite. Worker работает, пока
открыт терминал и включён Mac; после закрытия терминала или перезагрузки его запускают заново, автозапуска нет.
Подробности и сценарий двух терминалов — в [демо](docs/demos/scheduler.md),
[ADR 0004](docs/adr/0004-scheduler-worker.md) и README [фичи](apps/host/src/features/scheduler/README.md) и
[сервера](servers/scheduler/README.md).

## Совет по одежде

```sh
npm run dev -- outfit Новосибирск
```

Команда печатает три строки `MCP: get_current_weather`, `recommend_outfit`, `save_outfit_advice`, совет и путь
`.local/outfit/latest.md`; повторный запуск заменяет файл. В `ask` та же цепочка доступна модели одним
фасадом. Подробности — [ADR 0005](docs/adr/0005-outfit-pipeline.md), README [фичи](apps/host/src/features/outfit/README.md)
и [демо](docs/demos/outfit.md).

## Настройки

Необязательный `lab.config.yaml` находится в каталоге запуска; пример — [lab.config.example.yaml](lab.config.example.yaml).
Через npm корень запуска определяется по INIT_CWD, при прямом запуске — по рабочему каталогу.
Явный путь: `--config-file /путь/config.yaml`.
Формат — плоские ключи с точками. Приоритет: defaults < файл < env < CLI.

```sh
npm run dev -- --llm-max-output-tokens 256 ask "Объясни stdio одним предложением."
npm run dev -- --mcp-filesystem-root /абсолютный/путь mcp tools
```

Полные [настройки](docs/configuration.md) и [команды](docs/commands.md) генерируются из реестров.
DeepSeek вызывается с отключённым reasoning и без автоматических повторов.
Транспортная ошибка или незавершённая генерация возвращаются пользователю как ошибка.

## Разработка

```sh
npm run check
npm run test:watch
npm run lint:fix
npm run docs:generate
```

`check` включает Biome, typecheck, архитектурные проверки, документацию, Vitest с coverage и сборку.
Тесты не используют настоящий API-ключ и внешний API. Coverage выводится как отчёт, без общего процентного порога.
Pre-commit запускает ту же проверку; GitHub Actions проверяет push и pull request на Node 24.

```sh
npm run build
npm start -- help
npm start -- ask "Что делает host?"
npm start -- mcp tools
```

Сборка переписывает относительные `.ts`-импорты в `.js`, копирует Markdown и проверяет запуск из другого каталога.

## Навигация

- [Архитектура и правила развития](ARCHITECTURE.md)
- [Инструкции для агентов-кодеров](AGENTS.md)
- [Начальное решение](docs/adr/0001-repository-foundation.md)
- [Первое подключение MCP](docs/adr/0002-filesystem-mcp-discovery.md)
- [Native tool calling через Open‑Meteo MCP](docs/adr/0003-open-meteo-tool-calling.md)
- [Планировщик с worker в host](docs/adr/0004-scheduler-worker.md)
- [Пайплайн совета по одежде](docs/adr/0005-outfit-pipeline.md)
- [Host](apps/host/README.md)
- [Open‑Meteo MCP server](servers/open-meteo/README.md)
- [Scheduler MCP server](servers/scheduler/README.md)
- [Короткое демо](docs/demos/first-start.md)
- [Демо списка MCP-инструментов](docs/demos/mcp-tools.md)
- [Демо вызова Open‑Meteo MCP-инструмента](docs/demos/open-meteo-tool.md)
- [Демо планировщика в двух терминалах](docs/demos/scheduler.md)
- [Демо совета по одежде](docs/demos/outfit.md)
- [Направления курса](docs/course.md) — будущие задания, без реализации в текущем старте
