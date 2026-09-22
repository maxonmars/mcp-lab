import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const excluded = new Set(["node_modules", ".git", "dist", "coverage", ".local"]);

export function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function workspacePaths(root: string): string[] {
  return ["apps", "servers"].flatMap((group) => {
    const parent = join(root, group);
    if (!existsSync(parent)) return [];
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, "package.json")))
      .map((entry) => join(parent, entry.name));
  });
}

export function localPath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

export function isMain(url: string): boolean {
  return url === pathToFileURL(process.argv[1] ?? "").href;
}
