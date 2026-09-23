import type { Writable } from "node:stream";
import { styleText } from "node:util";

export type Tone = "heading" | "prompt" | "key" | "muted" | "error" | "errorLabel";
export type Paint = (tone: Tone, text: string) => string;

const styles: Record<Tone, Parameters<typeof styleText>[0]> = {
  heading: ["cyan", "bold"],
  prompt: "magenta",
  key: "bold",
  muted: "gray",
  error: "red",
  errorLabel: ["red", "bold"],
};

/** Цвет решает styleText для конкретного потока: TTY, NO_COLOR, NODE_DISABLE_COLORS, FORCE_COLOR. */
export function painter(stream: Writable): Paint {
  return (tone, text) => (text ? styleText(styles[tone], text, { stream }) : text);
}
