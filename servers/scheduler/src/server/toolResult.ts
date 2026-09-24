import { ServiceError } from "../service/errors.ts";

export type ToolReply = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

export function reply(text: string, structuredContent?: Record<string, unknown>): ToolReply {
  return { content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) };
}

export function failure(text: string): ToolReply {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Текст ошибки хранилища не покидает stderr: клиенту уходит только безопасная формулировка. */
export function guarded(work: () => ToolReply): ToolReply {
  try {
    return work();
  } catch (error) {
    if (error instanceof ServiceError) return failure(error.message);
    console.error(error);
    return failure("Хранилище планировщика недоступно.");
  }
}

export function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}
