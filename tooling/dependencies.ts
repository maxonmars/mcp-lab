import { resolve } from "node:path";
import { cruise } from "dependency-cruiser";
import { dependencyRules } from "./dependency-rules.ts";
import { files, isMain, localPath } from "./files.ts";

export async function checkDependencies(root: string): Promise<number> {
  const paths = files(root).map((path) => localPath(root, path));
  const features = [...new Set(paths.flatMap((path) => path.match(/^(.*\/src\/features\/[^/]+)\//)?.[1] ?? []))];
  const sources = paths.filter((path) => /^(apps|servers|tooling)\/.*\.(ts|js|mjs|cjs)$/.test(path));
  const result = await cruise(sources, {
    ruleSet: { forbidden: dependencyRules(features) },
    validate: true,
    tsPreCompilationDeps: true,
    tsConfig: { fileName: resolve(root, "tsconfig.json") },
    doNotFollow: { path: "(^|/)(node_modules|dist|coverage)/" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "node", "default", "types"] },
    preserveSymlinks: false,
  });
  if (typeof result.output === "string") throw new Error("Expected dependency graph");
  for (const violation of result.output.summary.violations) {
    console.error(`${violation.rule.name}: ${violation.from} → ${violation.to}`);
  }
  return result.output.summary.error;
}

if (isMain(import.meta.url)) {
  const root = resolve(process.argv[2] ?? ".");
  process.chdir(root);
  const count = await checkDependencies(root);
  console.log(`Границы зависимостей: ${count} ошибок.`);
  process.exitCode = count > 0 ? 1 : 0;
}
