import { z } from "zod";
import { sections } from "./markdown.ts";

const descriptions = sections(new URL("./settings.md", import.meta.url));
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const settings = {
  "config.file": { schema: z.string().trim().min(1), default: "lab.config.yaml", type: "string", file: false },
  "llm.model": { schema: z.string().trim().min(1), default: "deepseek-flash", type: "string" },
  "llm.timeoutMs": { schema: positiveInteger, default: 30000, type: "number" },
  "llm.maxOutputTokens": { schema: positiveInteger, default: 1024, type: "number" },
  "llm.apiKey": { schema: z.string().trim().min(1).nullable(), default: null, type: "string", secret: true },
  "mcp.filesystemRoot": {
    schema: z.string().trim().min(1),
    default: "docs/demos/fixtures/filesystem",
    type: "string",
  },
  "mcp.timeoutMs": { schema: positiveInteger, default: 10000, type: "number" },
  "scheduler.dbPath": { schema: z.string().trim().min(1), default: ".local/scheduler.sqlite", type: "string" },
  "scheduler.reportsDir": { schema: z.string().trim().min(1), default: ".local/reports", type: "string" },
} as const;

export type SettingKey = keyof typeof settings;
export type Values = { [K in SettingKey]: z.output<(typeof settings)[K]["schema"]> };

export const settingEntries = Object.entries(settings).map(([key, entry]) => ({
  ...entry,
  key: key as SettingKey,
  description: descriptions[key] ?? "",
  env: `LAB_${key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replaceAll(".", "_")
    .toUpperCase()}`,
  flag: `--${key
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll(".", "-")
    .toLowerCase()}`,
  secret: "secret" in entry && entry.secret,
  file: !("file" in entry) && !("secret" in entry),
}));
