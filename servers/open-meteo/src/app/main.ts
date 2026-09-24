import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createWeatherServer } from "../index.ts";
import { OPEN_METEO_TIMEOUT_MS } from "../weather/constants.ts";

// Ctrl+C приходит всей группе процессов терминала; worker планировщика завершает опрос и закрывает stdin сам.
if (process.argv.includes("--ignore-sigint")) process.on("SIGINT", () => {});

serveStdio(() => createWeatherServer({ fetchImpl: fetch, timeoutMs: OPEN_METEO_TIMEOUT_MS }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
