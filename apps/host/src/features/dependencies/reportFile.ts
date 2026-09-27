export const DEPENDENCY_REPORTS_DIR = ".local/reports";
export const MAX_REPORT_CHARS = 20_000;

const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** То же выражение, что у входа get_npm_package сервера npm-registry: host и серверы не делят код. */
export function isNpmPackageName(name: string): boolean {
  return NPM_PACKAGE_NAME_PATTERN.test(name);
}

/** zod → dependency-zod.md; @types/node → dependency-types__node.md. */
export function reportFileName(packageName: string): string {
  return `dependency-${packageName.replace(/^@/, "").replaceAll("/", "__")}.md`;
}
