import { type Command, commandHelp } from "../adapters/cli/index.ts";
import { sections } from "./markdown.ts";
import { settingEntries } from "./settings.ts";

const descriptions = sections(new URL("./commands.md", import.meta.url));

export function createCommands(context: {
  ask: (text: string) => Promise<string>;
  config: () => string;
  print: (text: string) => void;
}): readonly Command[] {
  const commands: Command[] = [
    {
      name: "ask",
      arguments: ["<текст...>"],
      description: descriptions.ask ?? "",
      run: async (args) => {
        context.print(await context.ask(args.join(" ")));
        return "continue";
      },
    },
    {
      name: "help",
      arguments: [],
      aliases: ["--help", "-h"],
      description: descriptions.help ?? "",
      run: async () => {
        context.print(commandHelp(commands));
        context.print(
          settingEntries
            .filter((entry) => !entry.secret)
            .map((entry) => `${entry.flag} <${entry.type}> — ${entry.description}`)
            .join("\n"),
        );
        return "continue";
      },
    },
    {
      name: "config show",
      arguments: [],
      description: descriptions["config show"] ?? "",
      run: async () => {
        context.print(context.config());
        return "continue";
      },
    },
    {
      name: "exit",
      arguments: [],
      description: descriptions.exit ?? "",
      run: async () => "exit",
    },
  ];
  return commands;
}
