import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { type ConfigRow, InputError } from "../adapters/cli/index.ts";
import { type SettingKey, settingEntries, settings, type Values } from "./settings.ts";

type Source = "default" | "file" | "env" | "cli";
export type ResolvedConfig = Readonly<{ values: Values; sources: Record<SettingKey, Source> }>;

export function parseOptions(
  argv: readonly string[],
  commandAliases: readonly string[] = [],
): { command: string[]; flags: Record<string, string> } {
  const command: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? "";
    if (token === "--") return { command: [...command, ...argv.slice(index + 1)], flags };
    if (!token.startsWith("--") || commandAliases.includes(token)) {
      command.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals < 0 ? token : token.slice(0, equals);
    const entry = settingEntries.find((item) => item.flag === name && !item.secret);
    if (!entry) throw new InputError("Неизвестный или недоступный флаг. Используйте help.");
    const value = equals < 0 ? argv[++index] : token.slice(equals + 1);
    if (value === undefined || value.startsWith("--")) throw new InputError(`Не задано значение ${entry.flag}.`);
    if (Object.hasOwn(flags, entry.key)) throw new InputError(`Флаг ${entry.flag} указан повторно.`);
    flags[entry.key] = value;
  }
  return { command, flags };
}

function parseValue(entry: (typeof settingEntries)[number], value: unknown, source: Source): unknown {
  const input = entry.type === "number" && typeof value === "string" && value.trim() ? Number(value) : value;
  const parsed = entry.schema.safeParse(input);
  if (!parsed.success) throw new InputError(`Некорректная настройка ${entry.key} (источник: ${source}).`);
  return parsed.data;
}

function readConfig(path: string, explicit: boolean): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!explicit && error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new InputError("Не удалось прочитать файл конфигурации.");
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    throw new InputError("Файл конфигурации содержит некорректный YAML.");
  }
  if (data === null) return {};
  if (typeof data !== "object" || Array.isArray(data)) throw new InputError("Конфигурация должна быть словарём.");
  for (const key of Object.keys(data)) {
    if (!settingEntries.some((entry) => entry.key === key && entry.file)) {
      throw new InputError("В файле конфигурации есть неизвестная или недоступная настройка.");
    }
  }
  return data as Record<string, unknown>;
}

export function resolveConfig(
  flags: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ResolvedConfig {
  const fileEntry = settingEntries.find((entry) => entry.key === "config.file");
  if (!fileEntry) throw new Error("Missing config.file setting");
  const explicit = flags[fileEntry.key] !== undefined || env[fileEntry.env] !== undefined;
  const rawPath = flags[fileEntry.key] ?? env[fileEntry.env] ?? settings["config.file"].default;
  const path = parseValue(fileEntry, rawPath, flags[fileEntry.key] !== undefined ? "cli" : "env") as string;
  const file = readConfig(resolve(cwd, path), explicit);
  const values: Record<string, unknown> = {};
  const sources: Record<string, Source> = {};
  for (const entry of settingEntries) {
    const candidates: [Source, unknown][] = [["default", entry.default]];
    if (Object.hasOwn(file, entry.key)) candidates.push(["file", file[entry.key]]);
    if (env[entry.env] !== undefined) candidates.push(["env", env[entry.env]]);
    if (Object.hasOwn(flags, entry.key)) {
      if (entry.secret) throw new InputError("Секреты разрешены только в env.");
      candidates.push(["cli", flags[entry.key]]);
    }
    for (const [source, value] of candidates) {
      values[entry.key] = parseValue(entry, value, source);
      sources[entry.key] = source;
    }
  }
  return { values: values as Values, sources: sources as Record<SettingKey, Source> };
}

export function showConfig(config: ResolvedConfig): ConfigRow[] {
  return settingEntries.map((entry) => ({
    key: entry.key,
    value: entry.secret ? (config.values[entry.key] ? "[задано]" : "[не задано]") : String(config.values[entry.key]),
    source: config.sources[entry.key],
  }));
}
