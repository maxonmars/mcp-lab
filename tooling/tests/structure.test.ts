import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkSize, limits } from "../size.ts";
import { checkStructure } from "../structure.ts";

it("не считает комментарии; отклоняет функцию и файл сверх лимита", () => {
  expect(checkSize("small.ts", "// comment\n".repeat(500))).toEqual([]);
  const body = "  console.log('x');\n".repeat(limits.function + 1);
  expect(checkSize("large.ts", `function large() {\n${body}}`)).toEqual([expect.stringContaining("функция")]);
  expect(checkSize("large.ts", "const x = 1;\n".repeat(limits.source + 1))).toEqual([
    expect.stringContaining("строк кода"),
  ]);
});

it("исключает только контейнер describe, но не длинное тело it", () => {
  const smallTests = "it('x', () => {});\n".repeat(70);
  expect(
    checkSize("suite.test.ts", `import {describe,it} from 'vitest';\ndescribe('suite', () => {\n${smallTests}});`),
  ).toEqual([]);
  const body = "console.log('x');\n".repeat(70);
  expect(checkSize("suite.test.ts", `import {it} from 'vitest';\nit('case', () => {\n${body}});`)).toEqual([
    expect.stringContaining("функция"),
  ]);
});

it("требует шаблон фичи и CLAUDE.md рядом с AGENTS.md", () => {
  const root = mkdtempSync(join(tmpdir(), "mcp-lab-structure-"));
  try {
    const feature = join(root, "apps/host/src/features/example");
    mkdirSync(feature, { recursive: true });
    writeFileSync(join(feature, "index.ts"), "export {};");
    writeFileSync(join(root, "AGENTS.md"), "# Rules\n");
    const errors = checkStructure(root).join("\n");
    expect(errors).toContain("README.md");
    expect(errors).toContain("tests/*.test.ts");
    expect(errors).toContain("CLAUDE.md");
    mkdirSync(join(feature, "tests"));
    writeFileSync(join(feature, "README.md"), "# Example");
    writeFileSync(join(feature, "tests/example.test.ts"), "export {};");
    writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
    expect(checkStructure(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
