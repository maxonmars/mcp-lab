import { WorkerLock } from "../../store/workerLock.ts";

const lock = WorkerLock.acquire(process.argv[2] ?? "");
console.log(lock ? "held" : "busy");
// Ссылка в колбэке нужна: без неё сборщик мусора закрывает соединение и снимает блокировку.
if (lock) setInterval(() => lock.release.length, 1000);
