import { AgentError } from "./errors.ts";
import type { Message, ModelPort } from "./model.ts";
import type { ToolCall, ToolDefinition, ToolSource } from "./tool.ts";

const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 1;

export type AgentOptions = Readonly<{ maxToolCalls?: number }>;

function requireMaxToolCalls(maxToolCalls: number | undefined): number {
  if (maxToolCalls === undefined) return DEFAULT_MAX_TOOL_CALLS_PER_TURN;
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls <= 0) {
    throw new RangeError("maxToolCalls должен быть положительным целым числом.");
  }
  return maxToolCalls;
}

export class Agent {
  readonly #model: ModelPort;
  readonly #systemPrompt: string;
  readonly #maxToolCalls: number;

  constructor(model: ModelPort, systemPrompt: string, options: AgentOptions = {}) {
    this.#model = model;
    this.#systemPrompt = systemPrompt;
    this.#maxToolCalls = requireMaxToolCalls(options.maxToolCalls);
  }

  async respond(input: string, toolSource?: ToolSource): Promise<string> {
    const question = input.trim();
    if (!question) throw new AgentError("EMPTY_INPUT");

    const tools = toolSource ? await toolSource.listTools() : [];
    const messages: Message[] = [
      { role: "system", content: this.#systemPrompt },
      { role: "user", content: question },
    ];
    let used = 0;
    for (;;) {
      const completion = await this.#model.complete({
        messages: [...messages],
        tools,
        toolChoice: tools.length > 0 && used < this.#maxToolCalls ? "auto" : "none",
      });
      if (completion.type === "text") return requireText(completion.content);

      requireExecutable(completion.calls, tools, used, this.#maxToolCalls);
      messages.push({ role: "assistant", content: completion.content, toolCalls: completion.calls });
      for (const call of completion.calls) {
        // Источник — MCP-сессия: параллельные вызовы делят один stdio-транспорт, поэтому строго по порядку.
        const result = await (toolSource as ToolSource).callTool({ name: call.name, arguments: call.arguments });
        messages.push({ role: "tool", toolCallId: call.id, content: result.content });
      }
      used += completion.calls.length;
    }
  }
}

function requireText(content: string): string {
  if (!content.trim()) throw new AgentError("EMPTY_RESPONSE");
  return content;
}

function requireExecutable(
  calls: readonly ToolCall[],
  tools: readonly ToolDefinition[],
  used: number,
  max: number,
): void {
  if (calls.length === 0) throw new AgentError("INVALID_TOOL_CALL_COUNT", { count: 0 });
  if (used + calls.length > max) throw new AgentError("TOOL_CALL_LIMIT_EXCEEDED", { limit: max });
  for (const call of calls) requireKnownTool(tools, call.name);
  for (const call of calls) requireValidArguments(call);
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
