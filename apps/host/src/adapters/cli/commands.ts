import { InputError } from "./errors.ts";

export type Command = Readonly<{
  name: string;
  arguments: readonly string[];
  /** Сообщение, когда обязательный аргумент не указан; по умолчанию — про текст реплики. */
  missingArgument?: string;
  aliases?: readonly string[];
  description: string;
  run: (args: readonly string[]) => Promise<"continue" | "exit">;
}>;

export function dispatch(commands: readonly Command[], argv: readonly string[]): Promise<"continue" | "exit"> {
  const command = commands.find((item) => {
    const words = item.name.split(" ");
    return words.every((word, index) => argv[index] === word) || item.aliases?.includes(argv[0] ?? "");
  });
  if (!command) throw new InputError("Неизвестная команда. Используйте help.");
  const alias = command.aliases?.includes(argv[0] ?? "");
  const args = argv.slice(alias ? 1 : command.name.split(" ").length);
  if (command.arguments.length === 0 && args.length > 0) throw new InputError("У команды нет аргументов.");
  if (command.arguments.length > 0 && !args.join(" ").trim())
    throw new InputError(command.missingArgument ?? "Не указан текст реплики.");
  return command.run(args);
}

export function replArguments(line: string): string[] {
  const text = line.trim();
  if (!text.startsWith("/")) return ["ask", text];
  const [name = "", ...rest] = text.slice(1).split(/\s+/);
  return name === "ask" ? [name, text.slice(1 + name.length).trim()] : [name, ...rest];
}
