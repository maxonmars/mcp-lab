import { isAbsolute } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createDeepSeekAdvice, createWeatherServer, type OutfitDependencies } from "../index.ts";
import { OPEN_METEO_TIMEOUT_MS } from "../weather/constants.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function positiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) fail(`Задайте ${name} положительным целым числом.`);
  return value;
}

/** Режим совета по одежде: путь файла — из argv, параметры DeepSeek — только из env. */
function outfitDependencies(): OutfitDependencies | undefined {
  const index = process.argv.indexOf("--outfit-report-file");
  if (index < 0) return undefined;
  const reportFile = process.argv[index + 1];
  if (!reportFile || !isAbsolute(reportFile)) fail("Укажите абсолютный путь: --outfit-report-file <файл .md>.");
  const apiKey = process.env.LAB_LLM_API_KEY?.trim();
  const model = process.env.LAB_LLM_MODEL?.trim();
  if (!apiKey) fail("Задайте LAB_LLM_API_KEY в окружении процесса.");
  if (!model) fail("Задайте LAB_LLM_MODEL в окружении процесса.");
  const generateAdvice = createDeepSeekAdvice({
    apiKey,
    model,
    timeoutMs: positiveInteger("LAB_LLM_TIMEOUT_MS"),
    maxOutputTokens: positiveInteger("LAB_LLM_MAX_OUTPUT_TOKENS"),
  });
  return { generateAdvice, reportFile };
}

// Ctrl+C приходит всей группе процессов терминала; worker планировщика завершает опрос и закрывает stdin сам.
if (process.argv.includes("--ignore-sigint")) process.on("SIGINT", () => {});

const outfit = outfitDependencies();
serveStdio(
  () => createWeatherServer({ fetchImpl: fetch, timeoutMs: OPEN_METEO_TIMEOUT_MS, now: () => Date.now() }, outfit),
  { onerror: (error) => console.error(error) },
);

process.stdin.on("end", () => process.exit(0));
