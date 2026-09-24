import { mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Эксклюзивная транзакция SQLite на файле рядом с базой; ОС снимает её при любом завершении процесса.
 * Объект должен оставаться достижимым: сборщик мусора закрывает соединение.
 */
export class WorkerLock {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  static acquire(dbPath: string): WorkerLock | undefined {
    const db = new DatabaseSync(lockPath(dbPath));
    try {
      db.exec("PRAGMA locking_mode = EXCLUSIVE");
      db.exec("BEGIN EXCLUSIVE");
    } catch {
      db.close();
      return undefined;
    }
    return new WorkerLock(db);
  }

  release(): void {
    this.#db.close();
  }
}

/** Путь блокировки строится от реального каталога базы, чтобы разные записи одного пути делили блокировку. */
export function lockPath(dbPath: string): string {
  mkdirSync(dirname(dbPath), { recursive: true });
  return join(realpathSync(dirname(dbPath)), `${basename(dbPath)}.lock`);
}
