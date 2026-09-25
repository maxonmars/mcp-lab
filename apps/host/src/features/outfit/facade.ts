import type { JsonObject, ToolDefinition, ToolResult, ToolSource } from "../../core/index.ts";
import { describeOutfitError, OutfitError } from "./errors.ts";
import { GET_CURRENT_WEATHER, INTERNAL_TOOLS, PREPARE_OUTFIT_ADVICE } from "./names.ts";
import { runOutfitPipeline } from "./runner.ts";

export type OutfitFacadeOptions = Readonly<{ reportPath: string }>;

const facadeDefinition: ToolDefinition = {
  name: PREPARE_OUTFIT_ADVICE,
  description:
    "Готовит практический совет, что надеть при выходе сейчас на 2–3 часа: получает текущую погоду и прогноз " +
    "на три часа, составляет совет и сохраняет его в файл. Используй, когда просят совет по одежде, а не просто погоду.",
  inputSchema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        minLength: 2,
        maxLength: 100,
        description: "Город и необязательная страна или регион, например «Новосибирск, Россия».",
      },
    },
    required: ["location"],
    additionalProperties: false,
  },
};

async function prepareAdvice(source: ToolSource, args: JsonObject, options: OutfitFacadeOptions): Promise<ToolResult> {
  const location = typeof args.location === "string" ? args.location : "";
  try {
    const { markdown } = await runOutfitPipeline(source, location);
    return { isError: false, content: `${markdown.trimEnd()}\n\nСовет сохранён в файл ${options.reportPath}.` };
  } catch (error) {
    const content =
      error instanceof OutfitError ? describeOutfitError(error) : "Не удалось подготовить совет по одежде.";
    return { isError: true, content };
  }
}

/**
 * Проекция полного источника Open‑Meteo для Agent: шаги пайплайна скрыты, вместо них — фасад.
 * Фасад объявляется, только если источник предоставляет все три инструмента пайплайна.
 */
export function outfitToolSource(source: ToolSource, options: OutfitFacadeOptions): ToolSource {
  return {
    listTools: async () => {
      const tools = await source.listTools();
      const names = new Set(tools.map((tool) => tool.name));
      const visible = tools.filter((tool) => !INTERNAL_TOOLS.has(tool.name));
      const ready = [GET_CURRENT_WEATHER, ...INTERNAL_TOOLS].every((name) => names.has(name));
      return ready ? [...visible, facadeDefinition] : visible;
    },
    callTool: async (invocation) => {
      if (INTERNAL_TOOLS.has(invocation.name)) throw new OutfitError("HIDDEN_TOOL");
      if (invocation.name === PREPARE_OUTFIT_ADVICE) return prepareAdvice(source, invocation.arguments, options);
      return source.callTool(invocation);
    },
  };
}
