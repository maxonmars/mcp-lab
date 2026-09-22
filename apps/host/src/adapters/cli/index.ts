import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type Command, dispatch, replArguments } from "./commands.ts";
import { describeError } from "./errors.ts";

export { type Command, commandHelp, dispatch, replArguments } from "./commands.ts";
export { describeError, InputError } from "./errors.ts";

export type Terminal = Readonly<{
  input: Readable;
  output: Writable;
  error: Writable;
  interactive: boolean;
}>;

export async function runCli(
  commands: readonly Command[],
  argv: readonly string[],
  terminal: Terminal,
): Promise<number> {
  if (argv.length > 0) {
    try {
      await dispatch(commands, argv);
      return 0;
    } catch (error) {
      terminal.error.write(`Ошибка: ${describeError(error)}\n`);
      return 1;
    }
  }
  const lines = createInterface({ input: terminal.input, crlfDelay: Infinity });
  let exitCode = 0;
  try {
    if (terminal.interactive) terminal.output.write("mcp-lab > ");
    for await (const line of lines) {
      if (line.trim()) {
        try {
          if ((await dispatch(commands, replArguments(line))) === "exit") break;
        } catch (error) {
          terminal.error.write(`Ошибка: ${describeError(error)}\n`);
          exitCode = 1;
        }
      }
      if (terminal.interactive) terminal.output.write("mcp-lab > ");
    }
  } finally {
    lines.close();
  }
  return exitCode;
}
