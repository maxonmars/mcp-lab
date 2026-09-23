import { CliView } from "../adapters/cli/index.ts";
import { run } from "./compose.ts";

try {
  process.exitCode = await run({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    nodeExecutable: process.execPath,
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
