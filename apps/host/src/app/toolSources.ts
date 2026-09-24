import type { ToolDefinition, ToolSource } from "../core/index.ts";

/** Объединяет источники в один ToolSource; вызов направляется по имени инструмента. */
export function combineToolSources(sources: readonly ToolSource[]): ToolSource {
  const owners = new Map<string, ToolSource>();
  return {
    listTools: async () => {
      const lists = await Promise.all(sources.map(async (source) => ({ source, tools: await source.listTools() })));
      owners.clear();
      const all: ToolDefinition[] = [];
      for (const { source, tools } of lists) {
        for (const tool of tools) {
          if (owners.has(tool.name)) throw new Error("Два MCP-сервера объявили инструмент с одним именем.");
          owners.set(tool.name, source);
          all.push(tool);
        }
      }
      return all;
    },
    callTool: (invocation) => {
      const owner = owners.get(invocation.name);
      if (!owner) throw new Error("Инструмент не входит ни в один источник.");
      return owner.callTool(invocation);
    },
  };
}
