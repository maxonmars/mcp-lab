import type { IForbiddenRuleType } from "dependency-cruiser";

function escaped(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const baseRules: IForbiddenRuleType[] = [
  { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
  {
    name: "no-source-dist-imports",
    severity: "error",
    from: {},
    to: { path: "(^|/)(dist|coverage)/", pathNot: "(^|/)node_modules/" },
  },
  {
    name: "core-is-independent",
    severity: "error",
    from: { path: "^((?:apps|servers)/[^/]+/src/core)/", pathNot: "/tests/" },
    to: { pathNot: "^$1/" },
  },
  {
    name: "features-no-app-or-global-adapters",
    severity: "error",
    from: { path: "/src/features/" },
    to: { path: "/src/(app|adapters)/" },
  },
  { name: "adapters-no-app", severity: "error", from: { path: "/adapters/" }, to: { path: "/src/app/" } },
  {
    name: "no-host-server-imports",
    severity: "error",
    from: { path: "^apps/" },
    to: { path: "^servers/" },
  },
  {
    name: "servers-are-independent",
    severity: "error",
    from: { path: "^(servers/[^/]+)/" },
    to: { path: "^(apps|servers)/", pathNot: "^$1/" },
  },
  {
    name: "no-production-test-imports",
    severity: "error",
    from: { path: "/src/", pathNot: "/tests/" },
    to: { path: "/tests/" },
  },
  { name: "runtime-no-tooling", severity: "error", from: { path: "^(apps|servers)/" }, to: { path: "^tooling/" } },
];
export function dependencyRules(featurePaths: readonly string[]): IForbiddenRuleType[] {
  const rules = [...baseRules];
  for (const feature of featurePaths) {
    const path = escaped(feature);
    rules.push(
      {
        name: `feature-public-entry:${feature}`,
        severity: "error",
        from: { pathNot: `^${path}/` },
        to: { path: `^${path}/`, pathNot: `^${path}/index\\.ts$` },
      },
      {
        name: `features-are-independent:${feature}`,
        severity: "error",
        from: { path: `^${path}/` },
        to: { path: "/src/features/", pathNot: `^${path}/` },
      },
    );
  }
  return rules;
}
