# mcp-lab

Минимальный CLI-агент на TypeScript и Node 24. Репозиторий предназначен для будущих учебных заданий по MCP.
Сейчас агент отправляет системную инструкцию и текущую реплику в DeepSeek. Между репликами история не сохраняется.

## Запуск

```sh
nvm use
npm ci
npm run hooks:install
export LAB_LLM_API_KEY='ваш-ключ'
npm run dev
```

В REPL обычная строка отправляется агенту. `/help` показывает команды, `/exit` завершает ввод.
Каждая строка — независимый вопрос. EOF также завершает CLI.
Ошибки выводятся в stderr; после ошибки REPL можно продолжать, итоговый код процесса остаётся 1.

```sh
npm run dev -- ask "Что такое MCP? Ответь кратко."
npm run dev -- help
npm run dev -- config show
```

Справка и просмотр настроек работают без ключа и не обращаются к API.
`.env` автоматически не читается; ключ передаётся окружением. Значение секрета не выводится в config show.

## Настройки

Необязательный `lab.config.yaml` находится в каталоге запуска; пример — [lab.config.example.yaml](lab.config.example.yaml).
Через npm корень запуска определяется по INIT_CWD, при прямом запуске — по рабочему каталогу.
Явный путь: `--config-file /путь/config.yaml`.
Формат — плоские ключи с точками. Приоритет: defaults < файл < env < CLI.

```sh
npm run dev -- --llm-max-output-tokens 256 ask "Объясни stdio одним предложением."
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
```

Сборка переписывает относительные `.ts`-импорты в `.js`, копирует Markdown и проверяет запуск из другого каталога.

## Навигация

- [Архитектура и правила развития](ARCHITECTURE.md)
- [Инструкции для агентов-кодеров](AGENTS.md)
- [Начальное решение](docs/adr/0001-repository-foundation.md)
- [Host](apps/host/README.md)
- [Короткое демо](docs/demos/first-start.md)
- [Направления курса](docs/course.md) — будущие задания, без реализации в текущем старте
