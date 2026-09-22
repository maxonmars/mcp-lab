import { readFileSync, writeFileSync } from "node:fs";
import { createCommands } from "../apps/host/src/app/commands.ts";
import { settingEntries } from "../apps/host/src/app/settings.ts";
import { isMain } from "./files.ts";

export function generatedDocs(): Record<string, string> {
  const cell = (value: unknown) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const settings = settingEntries.map((entry) => {
    return `| ${entry.key} | ${entry.type} | ${entry.secret ? "—" : cell(entry.default)} | ${entry.env} | ${entry.secret ? "—" : entry.flag} | ${cell(entry.description)} |`;
  });
  const registry = createCommands({ ask: async () => "", config: () => "", print: () => {} });
  const commands = registry.map(
    (command) =>
      `| ${[command.name, ...command.arguments].join(" ")} | /${command.name} | ${cell(command.description)} |`,
  );
  return {
    "docs/configuration.md": [
      "# Настройки",
      "",
      "Генерируется из реестра: `npm run docs:generate`.",
      "",
      "Приоритет: defaults < YAML-файл < env < CLI. Любой некорректный заданный источник отклоняется.",
      "YAML содержит плоские ключи с точками. Секреты разрешены только в env; config.file недоступен внутри YAML.",
      "`.env` автоматически не загружается. config show показывает источник каждого значения.",
      "",
      "| Ключ | Тип | Default | Env | Флаг | Описание |",
      "|---|---|---|---|---|---|",
      ...settings,
      "",
    ].join("\n"),
    "docs/commands.md": [
      "# Команды",
      "",
      "Генерируется из реестра: `npm run docs:generate`.",
      "",
      "CLI: `npm run dev -- <команда>`. Без команды запускается REPL; обычная строка вызывает ask.",
      "CLI-флаги задаются при запуске. В REPL настройки не изменяются.",
      "CLI использует quoting оболочки; в REPL остаток /ask передаётся как текст без обработки кавычек.",
      "",
      "| CLI | REPL | Описание |",
      "|---|---|---|",
      ...commands,
      "",
      ...registry
        .filter((command) => command.aliases?.length)
        .map((command) => `Алиасы ${command.name}: ${command.aliases?.join(", ")}.`),
      "Чтобы передать текст, начинающийся с --, используйте `ask -- <текст>`.",
      "",
    ].join("\n"),
  };
}

if (isMain(import.meta.url)) {
  let stale = false;
  for (const [path, expected] of Object.entries(generatedDocs())) {
    if (process.argv.includes("--write")) writeFileSync(path, expected);
    else if (readFileSync(path, "utf8") !== expected) {
      console.error(`Устарела документация: ${path}`);
      stale = true;
    }
  }
  process.exitCode = stale ? 1 : 0;
}
