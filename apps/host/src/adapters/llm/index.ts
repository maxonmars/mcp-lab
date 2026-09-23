import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  AgentError,
  type JsonObject,
  type Message,
  type ModelCompletion,
  type ModelPort,
  type ModelRequest,
  type ToolCall,
  type ToolDefinition,
} from "../../core/index.ts";

export type DeepSeekOptions = Readonly<{
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetch?: typeof globalThis.fetch;
}>;

export class DeepSeekModel implements ModelPort {
  readonly #client: OpenAI;
  readonly #options: DeepSeekOptions;

  constructor(options: DeepSeekOptions) {
    this.#options = { ...options };
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: "https://api.deepseek.com",
      timeout: options.timeoutMs,
      maxRetries: 0,
      fetch: options.fetch,
    });
  }

  async complete(request: ModelRequest): Promise<ModelCompletion> {
    try {
      const wireRequest = {
        model: this.#options.model,
        messages: request.messages.map(toWireMessage),
        max_tokens: this.#options.maxOutputTokens,
        thinking: { type: "disabled" },
        ...(request.tools.length > 0 ? { tools: request.tools.map(toWireTool), tool_choice: request.toolChoice } : {}),
      };
      const response = await this.#client.chat.completions.create(wireRequest);
      return toCompletion(response);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      throw new AgentError("MODEL_FAILURE", status === undefined ? {} : { status });
    }
  }
}

function toWireMessage(message: Message): ChatCompletionMessageParam {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content, tool_calls: message.toolCalls.map(toWireToolCall) };
  }
  if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  return { role: message.role, content: message.content };
}

function toWireToolCall(call: ToolCall): ChatCompletionMessageToolCall {
  return { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
}

function toWireTool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

function toCompletion(response: ChatCompletion): ModelCompletion {
  const choice = response.choices[0];
  if (!choice) throw new AgentError("EMPTY_RESPONSE");
  if (choice.finish_reason === "tool_calls") return toToolCallsCompletion(choice.message);
  if (choice.finish_reason === "stop") return { type: "text", content: choice.message.content ?? "" };
  throw new AgentError("INCOMPLETE_RESPONSE", { reason: choice.finish_reason });
}

function toToolCallsCompletion(message: ChatCompletionMessage): ModelCompletion {
  const calls = message.tool_calls ?? [];
  if (calls.length === 0) throw new AgentError("INVALID_TOOL_CALL_COUNT", { count: 0 });
  return { type: "tool_calls", content: message.content ?? undefined, calls: calls.map(toCoreToolCall) };
}

function toCoreToolCall(call: ChatCompletionMessageToolCall): ToolCall {
  if (call.type !== "function") throw new AgentError("INVALID_TOOL_ARGUMENTS", { name: call.type });
  return {
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.name, call.function.arguments),
  };
}

function parseArguments(name: string, raw: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentError("INVALID_TOOL_ARGUMENTS", { name });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AgentError("INVALID_TOOL_ARGUMENTS", { name });
  }
  return parsed as JsonObject;
}
