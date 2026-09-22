import { readFileSync } from "node:fs";
import { InputError, runCli, type Terminal } from "../adapters/cli/index.ts";
import { DeepSeekModel, type DeepSeekOptions } from "../adapters/llm/index.ts";
import { Agent, type ModelPort } from "../core/index.ts";
import { createCommands } from "./commands.ts";
import { parseOptions, resolveConfig, showConfig } from "./config.ts";

export async function run(options: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  terminal: Terminal;
  createModel?: (options: DeepSeekOptions) => ModelPort;
}): Promise<number> {
  let agent: Agent | undefined;
  const commands = createCommands({
    ask: (text) => {
      if (!agent) {
        const apiKey = config.values["llm.apiKey"];
        if (!apiKey) throw new InputError("Задайте LAB_LLM_API_KEY в окружении процесса.");
        const model = (options.createModel ?? ((settings) => new DeepSeekModel(settings)))({
          apiKey,
          model: config.values["llm.model"],
          timeoutMs: config.values["llm.timeoutMs"],
          maxOutputTokens: config.values["llm.maxOutputTokens"],
        });
        agent = new Agent(model, readFileSync(new URL("./system.md", import.meta.url), "utf8"));
      }
      return agent.respond(text);
    },
    config: () => showConfig(config),
    print: (text) => {
      options.terminal.output.write(`${text}\n`);
    },
  });
  const { command, flags } = parseOptions(
    options.argv,
    commands.flatMap((item) => item.aliases ?? []),
  );
  const config = resolveConfig(flags, options.env, options.cwd);
  return runCli(commands, command, options.terminal);
}
