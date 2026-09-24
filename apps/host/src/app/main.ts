import { CliView } from "../adapters/cli/index.ts";
import { run } from "./compose.ts";

/** npm пересылает SIGINT дочернему процессу, поэтому один Ctrl+C приходит дважды подряд. */
const REPEATED_SIGNAL_GRACE_MS = 1_000;

/** Первый сигнал просит worker завершиться; повторный позже REPEATED_SIGNAL_GRACE_MS завершает процесс сразу. */
function interrupt(): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  let firstAt = 0;
  const onSignal = () => {
    if (!controller.signal.aborted) {
      firstAt = Date.now();
      controller.abort();
    } else if (Date.now() - firstAt > REPEATED_SIGNAL_GRACE_MS) {
      process.exit(130);
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return {
    signal: controller.signal,
    release: () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
}

try {
  process.exitCode = await run({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    nodeExecutable: process.execPath,
    interrupt,
    terminal: {
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
      interactive: !!process.stdin.isTTY,
    },
  });
} catch (error) {
  new CliView(process.stdout, process.stderr).error(error);
  process.exitCode = 1;
}
