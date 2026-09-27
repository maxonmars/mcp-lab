# dependencies: проверка обновления npm-зависимости host

## Назначение

Проекция локального Filesystem MCP для сценария «проверь, стоит ли обновить зависимость host, и сохрани
отчёт» (`ask`, [ADR 0007](../../../../../docs/adr/0007-orchestration-mcp.md)). Filesystem-серверу
разрешены только два каталога — `apps/host` (ради манифеста) и `.local/reports`; модели видны только два
фасада этой фичи, а не сырые инструменты Filesystem.

## Публичный контракт (`index.ts`)

- `dependencyFilesToolSource(source, { manifestPath, reportsDir })` — проекция `ToolSource` поверх
  Filesystem MCP:
  - `read_host_manifest` — без аргументов, вызывает `read_text_file({ path: manifestPath })`. Объявляется,
    только если источник предоставляет `read_text_file`.
  - `save_dependency_report({ packageName, markdown })` — оба поля обязательны,
    `additionalProperties: false`. Путь вычисляет фича: `<reportsDir>/dependency-<пакет>.md`
    (`@scope/pkg` → `dependency-scope__pkg.md`); модель путь не передаёт. Вызывает
    `write_file({ path, content: markdown.trimEnd() + "\n" })`. Объявляется, только если источник
    предоставляет `write_file`.
  - Лишний ключ аргументов, некорректное имя npm-пакета, пустой или слишком длинный `markdown` отклоняются
    до вызова `write_file`, с точной причиной в `isError`-результате. Любое другое имя инструмента, включая
    сырые `read_text_file`/`write_file`, недоступно.
  - Ошибка `read_text_file`/`write_file` возвращается моделью как `isError` с текстом
    «Манифест не прочитан: …» / «Отчёт не сохранён: …» без изменения причины сервера.
- `reportFileName(packageName)`, `isNpmPackageName(name)`, `DEPENDENCY_REPORTS_DIR`, `MAX_REPORT_CHARS` —
  вспомогательные константы и проверки для composition root и тестов.
- `prompts/dependencyTools.md` — инструкция модели: сначала манифест, затем npm, затем (при наличии
  репозитория GitHub) список и один релиз по тегу, затем отчёт по явной просьбе; без догадок о версиях,
  релизах и содержимом.

## Настройки и команда

Новых настроек нет. Путь манифеста и каталог отчётов вычисляет composition root (`app/dependencies.ts`)
от рабочего каталога и передаёт абсолютными. Команда — `ask`; Agent сам решает, вызывать ли эти
инструменты, по инструкции из `prompts/dependencyTools.md`.

Замену существующего отчёта того же пакета выполняет сам Filesystem-сервер (`@modelcontextprotocol/
server-filesystem@2026.8.31`, `write_file`: временный файл рядом и `rename`); новый файл он создаёт
эксклюзивной записью `wx`. `move_file` в этой фиче не используется: он отказывает, если файл назначения
уже существует.

## Ограничения

Фича не проверяет фактически установленную версию зависимости и не изменяет `package.json` —
только читает манифест и сохраняет текстовый отчёт. Не импортирует `mcp`, `outfit` и `scheduler`; запуск
Filesystem-процесса и его допустимые каталоги задаёт composition root.

## Проверка

`tests/files.test.ts` на fake `ToolSource`: скрытие сырых инструментов Filesystem, условное объявление
каждого фасада, фиксированный путь чтения манифеста, путь сохранения для обычного и scoped имени, все
отказы валидации без вызова `write_file`, проброс `isError` сервера с понятным текстом. Сценарий полного
`ask` через composition root, включая настоящий Filesystem-сервер, — в `app/tests/orchestration.test.ts` и
`app/tests/dependencyFiles.integration.test.ts`.
