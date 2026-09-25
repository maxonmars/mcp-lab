import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { composeAdvice, describeAdviceError } from "../outfit/advice.ts";
import type { GenerateAdvice } from "../outfit/deepseek.ts";
import { replaceAdviceFile } from "../outfit/reportFile.ts";

export const RECOMMEND_OUTFIT_TOOL_NAME = "recommend_outfit";
export const SAVE_OUTFIT_ADVICE_TOOL_NAME = "save_outfit_advice";

const MAX_TEXT_LENGTH = 20_000;

/** reportFile — абсолютный путь, заданный при запуске; в аргументах MCP пути нет. */
export type OutfitDependencies = Readonly<{ generateAdvice: GenerateAdvice; reportFile: string }>;

const nonBlank = (description: string) =>
  z
    .string()
    .max(MAX_TEXT_LENGTH)
    .refine((value) => value.trim().length > 0, "Текст не должен быть пустым.")
    .describe(description);

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

function readInstructions(): string {
  return readFileSync(new URL("../outfit/prompts/outfitAdvice.md", import.meta.url), "utf8").trim();
}

function registerRecommendOutfit(server: McpServer, deps: OutfitDependencies, instructions: string): void {
  server.registerTool(
    RECOMMEND_OUTFIT_TOOL_NAME,
    {
      description:
        "Составляет короткий совет по одежде, обуви и вещам с собой по тексту результата get_current_weather " +
        "с прогнозом на ближайшие часы. Возвращает Markdown с исходными данными о погоде.",
      inputSchema: z.object({ weatherText: nonBlank("Текст результата get_current_weather без изменений.") }),
      outputSchema: z.object({ markdown: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ weatherText }) => {
      try {
        const markdown = composeAdvice(await deps.generateAdvice({ instructions, weatherText }), weatherText);
        return { content: text(markdown), structuredContent: { markdown } };
      } catch (error) {
        return { isError: true, content: text(describeAdviceError(error)) };
      }
    },
  );
}

function registerSaveOutfitAdvice(server: McpServer, deps: OutfitDependencies): void {
  server.registerTool(
    SAVE_OUTFIT_ADVICE_TOOL_NAME,
    {
      description:
        "Сохраняет Markdown совета по одежде без изменений в фиксированный файл, заданный при запуске сервера, " +
        "заменяя прежний совет.",
      inputSchema: z.object({ markdown: nonBlank("Markdown результата recommend_outfit без изменений.") }),
      outputSchema: z.object({ path: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ markdown }) => {
      try {
        await replaceAdviceFile(deps.reportFile, markdown);
      } catch (error) {
        console.error(error);
        return { isError: true, content: text("Не удалось сохранить совет по одежде в файл.") };
      }
      return { content: text(`Совет сохранён: ${deps.reportFile}`), structuredContent: { path: deps.reportFile } };
    },
  );
}

export function registerOutfitTools(server: McpServer, deps: OutfitDependencies): void {
  registerRecommendOutfit(server, deps, readInstructions());
  registerSaveOutfitAdvice(server, deps);
}
