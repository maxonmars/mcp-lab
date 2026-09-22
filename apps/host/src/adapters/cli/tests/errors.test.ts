import { expect, it } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { describeError, InputError } from "../index.ts";

it("указывает лимит токенов только при finish_reason length", () => {
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "length" }))).toContain("лимиту токенов");
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "content_filter" }))).not.toContain("лимит");
});

it("показывает безопасную причину, но не текст неизвестной ошибки", () => {
  expect(describeError(new InputError("Неверный флаг"))).toBe("Неверный флаг");
  expect(describeError(new AgentError("MODEL_FAILURE", { status: 429 }))).toBe("API вернул HTTP 429.");
  expect(describeError(new AgentError("MODEL_FAILURE"))).toBe("Запрос к модели не выполнен.");
  expect(describeError(new Error("secret"))).not.toContain("secret");
});
