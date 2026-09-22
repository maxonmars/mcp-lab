import { describe, expect, it, vi } from "vitest";
import { Agent, AgentError } from "../index.ts";

describe("Agent", () => {
  it("отправляет только системную инструкцию и текущую реплику", async () => {
    const complete = vi.fn().mockResolvedValue("Ответ");
    const agent = new Agent({ complete }, "Системная инструкция");
    await expect(agent.respond("  Первый вопрос  ")).resolves.toBe("Ответ");
    await agent.respond("Второй вопрос");
    expect(complete.mock.calls[0]?.[0]).toEqual([
      { role: "system", content: "Системная инструкция" },
      { role: "user", content: "Первый вопрос" },
    ]);
    expect(complete.mock.calls[1]?.[0]).toEqual([
      { role: "system", content: "Системная инструкция" },
      { role: "user", content: "Второй вопрос" },
    ]);
  });

  it("не вызывает модель при пустом вводе", async () => {
    const complete = vi.fn();
    await expect(new Agent({ complete }, "").respond(" \n ")).rejects.toMatchObject({ code: "EMPTY_INPUT" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("отклоняет пустой ответ модели", async () => {
    await expect(new Agent({ complete: async () => " \n" }, "").respond("Вопрос")).rejects.toMatchObject({
      code: "EMPTY_RESPONSE",
    });
  });

  it("после ошибки не повторяет запрос и позволяет следующий вызов", async () => {
    const complete = vi.fn().mockRejectedValueOnce(new AgentError("MODEL_FAILURE")).mockResolvedValueOnce("OK");
    const agent = new Agent({ complete }, "");
    await expect(agent.respond("Первый")).rejects.toMatchObject({ code: "MODEL_FAILURE" });
    await expect(agent.respond("Второй")).resolves.toBe("OK");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
