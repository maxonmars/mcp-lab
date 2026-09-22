import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOptions, resolveConfig, showConfig } from "../config.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-config-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("конфигурация", () => {
  it("применяет defaults < файл < env < CLI и сохраняет источники", () => {
    writeFileSync(join(root, "lab.config.yaml"), "llm.model: file-model\nllm.timeoutMs: 10\n");
    const config = resolveConfig({ "llm.model": "cli-model" }, { LAB_LLM_MODEL: "env-model" }, root);
    expect(config.values["llm.model"]).toBe("cli-model");
    expect(config.sources["llm.model"]).toBe("cli");
    expect(config.values["llm.timeoutMs"]).toBe(10);
    expect(config.sources["llm.timeoutMs"]).toBe("file");
    expect(config.sources["llm.maxOutputTokens"]).toBe("default");
    expect(resolveConfig({}, { LAB_LLM_MODEL: "env-model" }, root).sources["llm.model"]).toBe("env");
  });

  it("не выводит секрет и не принимает его из файла или CLI", () => {
    const config = resolveConfig({}, { LAB_LLM_API_KEY: "sensitive" }, root);
    expect(showConfig(config)).toContain("llm.apiKey: [задано] (env)");
    expect(showConfig(config)).not.toContain("sensitive");
    expect(() => parseOptions(["--llm-api-key", "sensitive"])).toThrow();
    expect(() => resolveConfig({ "llm.apiKey": "sensitive" }, {}, root)).toThrow();
    writeFileSync(join(root, "lab.config.yaml"), "llm.apiKey: sensitive");
    expect(() => resolveConfig({}, {}, root)).toThrow(/недоступная настройка/);
  });

  it("отклоняет некорректный источник даже при наличии переопределения", () => {
    writeFileSync(join(root, "lab.config.yaml"), "llm.timeoutMs: -1");
    expect(() => resolveConfig({ "llm.timeoutMs": "20" }, {}, root)).toThrow(/источник: file/);
  });

  it.each(["llm.model: [x]", "unknown: value", "- list", "llm.model: ["])("отклоняет файл %s", (text) => {
    writeFileSync(join(root, "lab.config.yaml"), text);
    expect(() => resolveConfig({}, {}, root)).toThrow();
  });

  it("различает отсутствующий default-файл и явно указанный путь", () => {
    expect(resolveConfig({}, {}, root).values["llm.model"]).toBe("deepseek-flash");
    expect(() => resolveConfig({ "config.file": "missing.yaml" }, {}, root)).toThrow(/прочитать/);
  });

  it("разбирает флаги из реестра и сохраняет текст после --", () => {
    expect(parseOptions(["--llm-model=other", "ask", "--", "--literal"])).toEqual({
      flags: { "llm.model": "other" },
      command: ["ask", "--literal"],
    });
    for (const argv of [["--unknown", "x"], ["--llm-model"], ["--llm-model=x", "--llm-model=y"]]) {
      expect(() => parseOptions(argv)).toThrow();
    }
  });
});
