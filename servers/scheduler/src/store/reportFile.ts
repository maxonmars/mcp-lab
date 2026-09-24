import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function reportPath(reportsDir: string, scheduleId: string): string {
  return join(reportsDir, `${scheduleId}.md`);
}

/** Временный файл рядом с целевым и rename: читатель видит либо старую, либо новую копию целиком. */
export function replaceReportFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Копия `.md` производна от SQLite: отсутствующую или отличающуюся копию перезаписывают. false — не удалось. */
export function syncReportFile(path: string, text: string): boolean {
  try {
    if (readFileSync(path, "utf8") === text) return true;
  } catch {}
  try {
    replaceReportFile(path, text);
    return true;
  } catch {
    return false;
  }
}
