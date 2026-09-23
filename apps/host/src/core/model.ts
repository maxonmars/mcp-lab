import type { ToolCall, ToolDefinition } from "./tool.ts";

export type TextMessage = Readonly<{ role: "system" | "user"; content: string }>;
export type AssistantToolCallMessage = Readonly<{
  role: "assistant";
  content?: string;
  toolCalls: readonly ToolCall[];
}>;
export type ToolResultMessage = Readonly<{ role: "tool"; toolCallId: string; content: string }>;
export type Message = TextMessage | AssistantToolCallMessage | ToolResultMessage;

export type ModelRequest = Readonly<{
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  toolChoice: "auto" | "none";
}>;

export type ModelCompletion =
  | Readonly<{ type: "text"; content: string }>
  | Readonly<{ type: "tool_calls"; content?: string; calls: readonly ToolCall[] }>;

export interface ModelPort {
  complete(request: ModelRequest): Promise<ModelCompletion>;
}
