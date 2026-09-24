import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** hostModuleUrl — import.meta.url модуля host; .js означает собранный запуск, .ts — исходный. */
export function resolveSchedulerEntrypoint(hostModuleUrl: string): string {
  const relative = hostModuleUrl.endsWith(".js") ? "scheduler/dist/app/main.js" : "scheduler/src/app/main.ts";
  return resolve(APP_DIR, "../../../../servers", relative);
}
