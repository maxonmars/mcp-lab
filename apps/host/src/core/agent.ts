import { AgentError } from "./errors.ts";
import type { ModelPort } from "./model.ts";

export class Agent {
  readonly #model: ModelPort;
  readonly #systemPrompt: string;

  constructor(model: ModelPort, systemPrompt: string) {
    this.#model = model;
    this.#systemPrompt = systemPrompt;
  }

  async respond(input: string): Promise<string> {
    const question = input.trim();
    if (!question) throw new AgentError("EMPTY_INPUT");
    const response = await this.#model.complete([
      { role: "system", content: this.#systemPrompt },
      { role: "user", content: question },
    ]);
    if (!response.trim()) throw new AgentError("EMPTY_RESPONSE");
    return response;
  }
}
