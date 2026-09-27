import { describe, expect, it } from "vitest";
import { MAX_RELEASE_NOTES_CHARS } from "../github/constants.ts";
import { formatReleaseDetailsText, formatReleaseListText } from "../github/format.ts";

const zod = {
  tag: "v4.6.5",
  name: "v4.6.5",
  publishedAt: "2026-09-13T23:25:34Z",
  prerelease: false,
  htmlUrl: "https://github.com/colinhacks/zod/releases/tag/v4.6.5",
};

describe("formatReleaseListText", () => {
  it("печатает заголовок и строки релизов, новые сначала", () => {
    const beta = { ...zod, tag: "v4.7.0-beta.1", name: "v4.7.0-beta.1", prerelease: true };
    const text = formatReleaseListText({ owner: "colinhacks", repo: "zod", releases: [zod, beta] });
    expect(text.split("\n")).toEqual([
      "Релизы GitHub colinhacks/zod (показано 2, новые сначала):",
      "- v4.6.5 — «v4.6.5», опубликован 2026-09-13T23:25:34Z — https://github.com/colinhacks/zod/releases/tag/v4.6.5",
      "- v4.7.0-beta.1 — «v4.7.0-beta.1», опубликован 2026-09-13T23:25:34Z, предварительный — https://github.com/colinhacks/zod/releases/tag/v4.6.5",
    ]);
  });

  it("пустой список репозитория — отдельная фраза", () => {
    expect(formatReleaseListText({ owner: "colinhacks", repo: "zod", releases: [] })).toBe(
      "У репозитория colinhacks/zod нет опубликованных релизов GitHub.",
    );
  });
});

describe("formatReleaseDetailsText", () => {
  const details = { ...zod, owner: "colinhacks", repo: "zod" };

  it("печатает метаданные и заметки без изменений, если они короче предела", () => {
    const text = formatReleaseDetailsText({ ...details, body: "Что нового." });
    expect(text).toBe(
      [
        "Релиз GitHub colinhacks/zod v4.6.5",
        "Название: v4.6.5",
        "Опубликован: 2026-09-13T23:25:34Z",
        "Ссылка: https://github.com/colinhacks/zod/releases/tag/v4.6.5",
        "",
        "Заметки к релизу:\nЧто нового.",
      ].join("\n"),
    );
  });

  it("обрезает заметки длиннее предела и называет фактический размер", () => {
    const body = "x".repeat(MAX_RELEASE_NOTES_CHARS + 500);
    const text = formatReleaseDetailsText({ ...details, body });
    expect(text).toContain(`[Заметки обрезаны: показано ${MAX_RELEASE_NOTES_CHARS} из ${body.length} символов.]`);
    expect(text).not.toContain("x".repeat(MAX_RELEASE_NOTES_CHARS + 1));
  });

  it("пустые заметки называет явно", () => {
    const text = formatReleaseDetailsText(details);
    expect(text).toContain("Заметки к релизу: отсутствуют (GitHub вернул пустое описание).");
  });
});
