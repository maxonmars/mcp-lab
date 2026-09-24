import type { Command, CommandView, ConfigRow } from "../adapters/cli/index.ts";
import type { McpDiscoveryResult } from "../features/mcp/index.ts";
import { sections } from "./markdown.ts";
import { settingEntries } from "./settings.ts";

const descriptions = sections(new URL("./commands.md", import.meta.url));

type CommandContext = {
  ask: (text: string) => Promise<string>;
  config: () => readonly ConfigRow[];
  mcpTools: () => Promise<McpDiscoveryResult>;
  schedulerRun: () => Promise<void>;
  schedulerSummary: (target: string) => Promise<{ city: string; markdown: string }>;
  view: CommandView;
};

function schedulerCommands(context: CommandContext): Command[] {
  return [
    {
      name: "scheduler run",
      arguments: [],
      description: descriptions["scheduler run"] ?? "",
      run: async () => {
        await context.schedulerRun();
        return "continue";
      },
    },
    {
      name: "scheduler summary",
      arguments: ["<город|ID>"],
      missingArgument: "Не указан город или ID расписания.",
      description: descriptions["scheduler summary"] ?? "",
      run: async (args) => {
        const summary = await context.schedulerSummary(args.join(" ").trim());
        context.view.report(summary.city, summary.markdown);
        return "continue";
      },
    },
  ];
}

export function createCommands(context: CommandContext): readonly Command[] {
  const commands: Command[] = [
    {
      name: "ask",
      arguments: ["<текст...>"],
      description: descriptions.ask ?? "",
      run: async (args) => {
        context.view.answer(await context.ask(args.join(" ")));
        return "continue";
      },
    },
    {
      name: "help",
      arguments: [],
      aliases: ["--help", "-h"],
      description: descriptions.help ?? "",
      run: async () => {
        context.view.help(
          commands,
          settingEntries.filter((entry) => !entry.secret),
        );
        return "continue";
      },
    },
    {
      name: "config show",
      arguments: [],
      description: descriptions["config show"] ?? "",
      run: async () => {
        context.view.config(context.config());
        return "continue";
      },
    },
    {
      name: "mcp tools",
      arguments: [],
      description: descriptions["mcp tools"] ?? "",
      run: async () => {
        context.view.mcpTools(await context.mcpTools());
        return "continue";
      },
    },
    ...schedulerCommands(context),
    {
      name: "exit",
      arguments: [],
      description: descriptions.exit ?? "",
      run: async () => "exit",
    },
  ];
  return commands;
}
