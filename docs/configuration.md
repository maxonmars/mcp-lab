# Настройки

Генерируется из реестра: `npm run docs:generate`.

Приоритет: defaults < YAML-файл < env < CLI. Любой некорректный заданный источник отклоняется.
YAML содержит плоские ключи с точками. Секреты разрешены только в env; config.file недоступен внутри YAML.
`npm run dev` и `npm start` читают корневой `.env`, если он существует. Значения из окружения процесса имеют приоритет; config show показывает источник каждого значения.

| Ключ | Тип | Default | Env | Флаг | Описание |
|---|---|---|---|---|---|
| config.file | string | lab.config.yaml | LAB_CONFIG_FILE | --config-file | Путь к YAML-конфигурации относительно текущего рабочего каталога. |
| llm.model | string | deepseek-flash | LAB_LLM_MODEL | --llm-model | Идентификатор модели DeepSeek. |
| llm.timeoutMs | number | 30000 | LAB_LLM_TIMEOUT_MS | --llm-timeout-ms | Таймаут одного запроса к модели, миллисекунды. |
| llm.maxOutputTokens | number | 1024 | LAB_LLM_MAX_OUTPUT_TOKENS | --llm-max-output-tokens | Максимальное число токенов ответа. |
| llm.apiKey | string | — | LAB_LLM_API_KEY | — | Ключ DeepSeek; принимается только из env, значение никогда не выводится. |
| mcp.filesystemRoot | string | docs/demos/fixtures/filesystem | LAB_MCP_FILESYSTEM_ROOT | --mcp-filesystem-root | Путь к учебной папке Filesystem MCP относительно текущего рабочего каталога. |
| mcp.timeoutMs | number | 10000 | LAB_MCP_TIMEOUT_MS | --mcp-timeout-ms | Таймаут MCP-подключения, получения списка инструментов и вызова инструмента, миллисекунды. |
