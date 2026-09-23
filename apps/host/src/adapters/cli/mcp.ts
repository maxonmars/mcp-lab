import type { McpDiscoveryResult } from "../../features/mcp/index.ts";
import type { Paint } from "./paint.ts";

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replaceAll(/\s+/g, " ").trim().split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

export function mcpToolLines(result: McpDiscoveryResult, width: number, paint: Paint): string[] {
  const lines = [`${paint("muted", "Инструментов:")} ${result.tools.length}`];
  const tools = [...result.tools].sort((left, right) => left.name.localeCompare(right.name));
  const numberWidth = String(tools.length).length;
  const indent = " ".repeat(numberWidth + 2);
  tools.forEach((tool, index) => {
    lines.push("", `${paint("muted", `${String(index + 1).padStart(numberWidth)}.`)} ${paint("key", tool.name)}`);
    for (const line of wrapText(tool.description ?? "", Math.max(width - indent.length, 20))) {
      lines.push(`${indent}${line}`);
    }
  });
  return lines;
}
