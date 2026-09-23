export type JsonObject = Readonly<Record<string, unknown>>;

export type ToolDefinition = Readonly<{
  name: string;
  description?: string;
  inputSchema: JsonObject;
}>;

export type ToolCall = Readonly<{
  id: string;
  name: string;
  arguments: JsonObject;
}>;

export type ToolInvocation = Readonly<{
  name: string;
  arguments: JsonObject;
}>;

export type ToolResult = Readonly<{
  content: string;
  isError: boolean;
}>;

export interface ToolSource {
  listTools(): Promise<readonly ToolDefinition[]>;
  callTool(invocation: ToolInvocation): Promise<ToolResult>;
}
