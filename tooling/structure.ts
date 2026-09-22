import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { files, isMain, localPath, workspacePaths } from "./files.ts";
import { checkSize, limits } from "./size.ts";

function checkModule(path: string, allFiles: readonly string[]): string[] {
  const errors = ["README.md", "index.ts"]
    .filter((name) => !existsSync(join(path, name)))
    .map((name) => `${path}: отсутствует ${name}`);
  if (!allFiles.some((file) => file.startsWith(`${path}/tests/`) && file.endsWith(".test.ts"))) {
    errors.push(`${path}: отсутствуют tests/*.test.ts`);
  }
  return errors;
}

function environmentAccess(path: string, text: string): string[] {
  if (!/^(apps|servers)\//.test(path) || /\/tests\//.test(path) || /\/app\/main\.ts$/.test(path)) return [];
  const errors: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (
      (ts.isIdentifier(node) && node.text === "process") ||
      (ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /^(node:)?process$/.test(node.moduleSpecifier.text))
    ) {
      errors.push(`${path}: process доступен только в app/main.ts`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

export function checkStructure(root: string): string[] {
  const paths = files(root);
  const errors: string[] = [];
  for (const path of paths) {
    const relative = localPath(root, path);
    if (/\.(ts|js|mjs|cjs)$/.test(path)) {
      const text = readFileSync(path, "utf8");
      errors.push(...checkSize(relative, text), ...environmentAccess(relative, text));
    }
    if (path.endsWith("/AGENTS.md")) {
      const count = readFileSync(path, "utf8").trimEnd().split("\n").length;
      if (count > limits.agents) errors.push(`${relative}: ${count} строк, предел ${limits.agents}`);
      const claude = join(dirname(path), "CLAUDE.md");
      if (!existsSync(claude) || readFileSync(claude, "utf8").trim() !== "@AGENTS.md")
        errors.push(`${relative}: нужен CLAUDE.md с @AGENTS.md`);
    }
  }
  const featurePaths = [...new Set(paths.flatMap((path) => path.match(/^(.*\/src\/features\/[^/]+)\//)?.[1] ?? []))];
  for (const path of featurePaths) errors.push(...checkModule(path, paths));
  for (const workspace of workspacePaths(root)) {
    for (const name of [
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
      "src/index.ts",
      "src/app/main.ts",
      "tsconfig.build.json",
    ]) {
      if (!existsSync(join(workspace, name))) errors.push(`${workspace}: отсутствует ${name}`);
    }
    if (
      !paths.some((path) => path.startsWith(`${workspace}/`) && path.includes("/tests/") && path.endsWith(".test.ts"))
    ) {
      errors.push(`${workspace}: отсутствуют тесты`);
    }
  }
  return errors;
}

if (isMain(import.meta.url)) {
  const errors = checkStructure(resolve("."));
  for (const error of errors) console.error(error);
  console.log(`Структура и размеры: ${errors.length} ошибок.`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}
