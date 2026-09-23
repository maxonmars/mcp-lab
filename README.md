# mcp-lab

Учебный host на TypeScript и Node 24: CLI-агент с native tool calling через собственный Open‑Meteo
MCP-сервер и подключение к локальному Filesystem MCP. Агент отправляет системную инструкцию и текущую
реплику в DeepSeek; между репликами история не сохраняется. Для актуальной погоды DeepSeek сам решает
вызвать MCP-инструмент `get_current_weather`, не более одного вызова за реплику.

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
npm run dev -- help
npm run dev -- config show
npm run dev -- mcp tools
```

Справка, просмотр настроек и `mcp tools` работают без ключа. `mcp tools` получает список от настоящего
локального Filesystem-сервера, но не вызывает инструменты и не обращается к модели. `ask` требует ключ:
на каждый вызов host запускает собственный Open‑Meteo MCP-сервер по stdio и закрывает сессию после
ответа; если DeepSeek решит вызвать инструмент, перед ответом печатается одна строка
`MCP: get_current_weather — выполнено` (или `— ошибка`).
`npm run dev` и `npm start` читают корневой `.env`, если он существует. Переменная, переданная
окружением процесса, имеет приоритет. Значение секрета не выводится в config show.

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
- [Host](apps/host/README.md)
- [Open‑Meteo MCP server](servers/open-meteo/README.md)
- [Короткое демо](docs/demos/first-start.md)
- [Демо списка MCP-инструментов](docs/demos/mcp-tools.md)
- [Демо вызова Open‑Meteo MCP-инструмента](docs/demos/open-meteo-tool.md)
- [Направления курса](docs/course.md) — будущие задания, без реализации в текущем старте
