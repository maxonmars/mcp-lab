import { expect, it } from "vitest";
import { createCommands } from "../../apps/host/src/app/commands.ts";
import { settingEntries } from "../../apps/host/src/app/settings.ts";
import { generatedDocs } from "../docs.ts";

it("настройки имеют уникальные ключи и производные имена, описания и валидные defaults", () => {
  for (const field of ["key", "env", "flag"] as const) {
    expect(new Set(settingEntries.map((entry) => entry[field])).size).toBe(settingEntries.length);
  }
  for (const entry of settingEntries) {
    expect(entry.description.trim()).not.toBe("");
    expect(entry.schema.safeParse(entry.default).success).toBe(true);
    if (entry.secret) {
      expect(entry.default).toBeNull();
      expect(entry.file).toBe(false);
    }
  }
});

it("команды имеют уникальные имена и алиасы, описания, аргументы и обработчики", () => {
  const commands = createCommands({
    ask: async () => "",
    config: () => [],
    mcpTools: async () => ({ server: { name: "", version: "" }, tools: [] }),
    view: { answer: () => {}, help: () => {}, config: () => {}, mcpTools: () => {} },
  });
  const names = commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  expect(new Set(names).size).toBe(names.length);
  for (const command of commands) {
    expect(command.description.trim()).not.toBe("");
    expect(typeof command.run).toBe("function");
    expect(new Set(command.arguments).size).toBe(command.arguments.length);
  }
  expect(generatedDocs()).toEqual(generatedDocs());
});
