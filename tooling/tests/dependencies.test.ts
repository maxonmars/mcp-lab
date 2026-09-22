import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const script = fileURLToPath(new URL("../dependencies.ts", import.meta.url));
let root: string;
function put(path: string, text: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
function check() {
  const result = spawnSync(process.execPath, [script, root], { encoding: "utf8", timeout: 20000 });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-boundaries-"));
  put("package.json", '{"type":"module"}');
  put("tsconfig.json", '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}');
  put("apps/host/src/features/alpha/internal.ts", "export type Alpha = string; export const alpha = 1;");
  put("apps/host/src/features/alpha/index.ts", 'export { alpha, type Alpha } from "./internal.ts";');
  put("apps/host/src/features/beta/index.ts", "export type Beta = number; export const beta = 2;");
  put("apps/host/src/app/main.ts", 'import { alpha } from "../features/alpha/index.ts"; void alpha;');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it("разрешает внутренний импорт и публичный вход; запрещает межфичевый import type", () => {
  expect(check()).toEqual({ status: 0, output: expect.stringContaining("0 ошибок") });
  put(
    "apps/host/src/features/alpha/cross.ts",
    'import type { Beta } from "../beta/index.ts"; export type Result = Beta;',
  );
  const invalid = check();
  expect(invalid.status).toBe(1);
  expect(invalid.output).toContain("features-are-independent:");
  rmSync(join(root, "apps/host/src/features/alpha/cross.ts"));
  expect(check().status).toBe(0);
});

it("запрещает обход публичного входа, SDK в ядре и цикл", () => {
  put("apps/host/src/app/private.ts", 'import { alpha } from "../features/alpha/internal.ts"; void alpha;');
  put("apps/host/src/core/illegal.ts", 'import { readFileSync } from "node:fs"; void readFileSync;');
  put("apps/host/src/features/beta/one.ts", 'import "./two.ts";');
  put("apps/host/src/features/beta/two.ts", 'import "./one.ts";');
  const result = check();
  expect(result.status).toBe(1);
  expect(result.output).toContain("feature-public-entry:");
  expect(result.output).toContain("core-is-independent");
  expect(result.output).toContain("no-circular");
});

it("проверяет импорт по имени связанного workspace", () => {
  put("apps/host/package.json", '{"name":"@lab/host","type":"module","exports":"./src/features/beta/index.ts"}');
  mkdirSync(join(root, "node_modules/@lab"), { recursive: true });
  symlinkSync(join(root, "apps/host"), join(root, "node_modules/@lab/host"), "dir");
  put("apps/host/src/features/alpha/cross.ts", 'import { beta } from "@lab/host"; export const result = beta;');
  const result = check();
  expect(result.status).toBe(1);
  expect(result.output).toContain("features-are-independent:");
  expect(result.output).not.toContain("no-unresolved");
});
