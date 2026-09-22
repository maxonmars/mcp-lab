export type Message = Readonly<{ role: "system" | "user"; content: string }>;

export interface ModelPort {
  complete(messages: readonly Message[]): Promise<string>;
}
