# Список инструментов Filesystem MCP

Цель: получить список инструментов настоящего локального MCP-сервера через stdio без вызова модели.

## Требования

Нужны Node 24 и уже установленные зависимости (`npm ci`). Команды выполняются из корня репозитория;
ключ `LAB_LLM_API_KEY` не нужен.

## Запуск с учебной папкой по умолчанию

```sh
npm run dev -- mcp tools
```

Фрагмент фактического вывода (`@modelcontextprotocol/server-filesystem`, вывод в pipe, ширина 88 колонок):

```text
── MCP · secure-filesystem-server · 0.2.0 ──

Инструментов: 14

 1. create_directory
    Create a new directory or ensure a directory exists. Can create multiple nested
    directories in one operation. If the directory already exists, this operation will
    succeed silently. Perfect for setting up directory structures for projects or
    ensuring required paths exist. Only works within allowed directories.
…
14. write_file
    Create a new file or completely overwrite an existing file with new content. Use
    with caution as it will overwrite existing files without warning. Handles text
    content with proper encoding. Only works within allowed directories.
```

Инструменты пронумерованы по алфавиту, среди них `read_text_file`, `list_directory` и `write_file`.
Описание получено от сервера целиком: пробелы и переводы строк сведены, текст перенесён по ширине
терминала (без неё — 88 колонок). В терминале заголовок голубой, имена инструментов полужирные,
номера и счётчик приглушены; при `NO_COLOR=1` или выводе в файл структура та же, без цвета.

## Запуск с явно указанной папкой

```sh
npm run dev -- --mcp-filesystem-root "$(pwd)/docs/demos/fixtures/filesystem" mcp tools
```

В REPL та же операция использует настройки, определённые при запуске:

```sh
npm run dev
```

```text
/mcp tools
/exit
```

## Проверка ошибки пути

```sh
npm run dev -- --mcp-filesystem-root /tmp/mcp-lab-no-such-directory mcp tools
```

Ожидаемо команда завершится с кодом 1 и выведет в stderr: `Ошибка · Учебная папка MCP не существует.`

## Что показывает демо

Host создаёт клиентскую фичу, Filesystem MCP работает отдельным server-процессом, а stdio передаёт
протокольные сообщения между ними. Список получен от настоящего сервера; инструменты не выполнялись,
LLM и ключ DeepSeek в сценарии не участвуют. После получения списка клиент закрывает соединение, а
transport завершает дочерний процесс.
