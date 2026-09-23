import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FEATURE_DIR = dirname(fileURLToPath(import.meta.url));

/** hostModuleUrl — import.meta.url любого модуля host; .js означает собранный запуск, .ts — исходный. */
export function resolveOpenMeteoEntrypoint(hostModuleUrl: string): string {
  const relative = hostModuleUrl.endsWith(".js") ? "open-meteo/dist/app/main.js" : "open-meteo/src/app/main.ts";
  return resolve(FEATURE_DIR, "../../../../../servers", relative);
}
