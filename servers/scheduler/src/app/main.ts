import { isAbsolute } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createSchedulerServer, generateScheduleId, SchedulerService } from "../index.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const dbPath = option("--db");
const reportsDir = option("--reports-dir");
if (!dbPath || !reportsDir || !isAbsolute(dbPath) || !isAbsolute(reportsDir)) {
  console.error("Укажите абсолютные пути: --db <файл SQLite> --reports-dir <каталог отчётов>.");
  process.exit(2);
}

// Ctrl+C приходит всей группе процессов терминала; worker завершает запись и закрывает stdin сам.
if (process.argv.includes("--ignore-sigint")) process.on("SIGINT", () => {});

const service = new SchedulerService({ dbPath, reportsDir, now: () => Date.now(), newId: generateScheduleId });
const mode = process.argv.includes("--worker") ? "worker" : "public";
serveStdio(() => createSchedulerServer({ service, mode }), { onerror: (error) => console.error(error) });

function shutdown(): never {
  try {
    service.close();
  } catch (error) {
    console.error(error);
  }
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
