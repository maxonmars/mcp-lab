import { AgentError } from "./errors.ts";
import type { Message, ModelPort } from "./model.ts";
import type { ToolCall, ToolDefinition, ToolSource } from "./tool.ts";

const MAX_TOOL_CALLS_PER_TURN = 1;

export class Agent {
  readonly #model: ModelPort;
  readonly #systemPrompt: string;

  constructor(model: ModelPort, systemPrompt: string) {
    this.#model = model;
    this.#systemPrompt = systemPrompt;
  }

  async respond(input: string, toolSource?: ToolSource): Promise<string> {
    const question = input.trim();
    if (!question) throw new AgentError("EMPTY_INPUT");

    const tools = toolSource ? await toolSource.listTools() : [];
    const systemMessage: Message = { role: "system", content: this.#systemPrompt };
    const userMessage: Message = { role: "user", content: question };
    const first = await this.#model.complete({
      messages: [systemMessage, userMessage],
      tools,
      toolChoice: tools.length > 0 ? "auto" : "none",
    });
    if (first.type === "text") return requireText(first.content);

    const call = requireSingleCall(first.calls);
    requireKnownTool(tools, call.name);
    requireValidArguments(call);
    // tools непусты только когда передан toolSource, поэтому вызов ниже безопасен.
    const result = await (toolSource as ToolSource).callTool({ name: call.name, arguments: call.arguments });

    const assistantMessage: Message = { role: "assistant", content: first.content, toolCalls: [call] };
    const toolMessage: Message = { role: "tool", toolCallId: call.id, content: result.content };
    const second = await this.#model.complete({
      messages: [systemMessage, userMessage, assistantMessage, toolMessage],
      tools,
      toolChoice: "none",
    });
    if (second.type === "tool_calls") throw new AgentError("TOOL_CALL_LIMIT_EXCEEDED");
    return requireText(second.content);
  }
}

function requireText(content: string): string {
  if (!content.trim()) throw new AgentError("EMPTY_RESPONSE");
  return content;
}

function requireSingleCall(calls: readonly ToolCall[]): ToolCall {
  if (calls.length !== MAX_TOOL_CALLS_PER_TURN) {
    throw new AgentError("INVALID_TOOL_CALL_COUNT", { count: calls.length });
  }
  return calls[0];
}

function requireKnownTool(tools: readonly ToolDefinition[], name: string): void {
  if (!tools.some((tool) => tool.name === name)) throw new AgentError("UNKNOWN_TOOL_CALL", { name });
}

function requireValidArguments(call: ToolCall): void {
  const args: unknown = call.arguments;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new AgentError("INVALID_TOOL_ARGUMENTS", { name: call.name });
  }
}
