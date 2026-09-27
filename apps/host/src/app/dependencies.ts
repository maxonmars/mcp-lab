import { dirname, resolve } from "node:path";
import { DEPENDENCY_REPORTS_DIR } from "../features/dependencies/index.ts";
import { resolveFilesystemEntrypoint, type StdioToolSourceOptions } from "../features/mcp/index.ts";
import {
  resolveGithubReleasesEntrypoint,
  resolveHostManifest,
  resolveNpmRegistryEntrypoint,
  SERVER_NAMES,
} from "./serverEntrypoints.ts";

export function dependencyReportsDir(cwd: string): string {
  return resolve(cwd, DEPENDENCY_REPORTS_DIR);
}

/** Filesystem-серверу разрешены только каталог host (ради манифеста) и каталог отчётов. */
export function filesystemOptions(
  nodeExecutable: string,
  reportsDir: string,
  timeoutMs: number,
): StdioToolSourceOptions {
  return {
    command: nodeExecutable,
    args: [resolveFilesystemEntrypoint(), dirname(resolveHostManifest()), reportsDir],
    serverName: SERVER_NAMES.filesystem,
    timeoutMs,
  };
}

export function npmRegistryOptions(nodeExecutable: string, timeoutMs: number): StdioToolSourceOptions {
  return {
    command: nodeExecutable,
    args: [resolveNpmRegistryEntrypoint(import.meta.url)],
    serverName: SERVER_NAMES.npmRegistry,
    timeoutMs,
  };
}

export function githubReleasesOptions(nodeExecutable: string, timeoutMs: number): StdioToolSourceOptions {
  return {
    command: nodeExecutable,
    args: [resolveGithubReleasesEntrypoint(import.meta.url)],
    serverName: SERVER_NAMES.githubReleases,
    timeoutMs,
  };
}
