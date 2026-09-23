import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createWeatherServer } from "../index.ts";
import { OPEN_METEO_TIMEOUT_MS } from "../weather/constants.ts";

serveStdio(() => createWeatherServer({ fetchImpl: fetch, timeoutMs: OPEN_METEO_TIMEOUT_MS }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
