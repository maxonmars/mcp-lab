import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Метки серверов для строк `MCP:` и ошибок McpToolSourceError/SchedulerError. */
export const SERVER_NAMES = {
  openMeteo: "open-meteo",
  scheduler: "scheduler",
  filesystem: "filesystem",
  npmRegistry: "npm-registry",
  githubReleases: "github-releases",
} as const;

/** hostModuleUrl — import.meta.url модуля host; .js означает собранный запуск, .ts — исходный. */
function resolveServerEntrypoint(hostModuleUrl: string, workspace: string): string {
  const relative = hostModuleUrl.endsWith(".js") ? `${workspace}/dist/app/main.js` : `${workspace}/src/app/main.ts`;
  return resolve(APP_DIR, "../../../../servers", relative);
}

export function resolveSchedulerEntrypoint(hostModuleUrl: string): string {
  return resolveServerEntrypoint(hostModuleUrl, "scheduler");
}

export function resolveNpmRegistryEntrypoint(hostModuleUrl: string): string {
  return resolveServerEntrypoint(hostModuleUrl, "npm-registry");
}

export function resolveGithubReleasesEntrypoint(hostModuleUrl: string): string {
  return resolveServerEntrypoint(hostModuleUrl, "github-releases");
}

/** apps/host/package.json — от src/app и через .ts, и через собранный dist/app одинаково. */
export function resolveHostManifest(): string {
  return resolve(APP_DIR, "../../package.json");
}
