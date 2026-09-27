import { describe, expect, it } from "vitest";
import { parseGithubRepository, repositoryDisplayUrl } from "../registry/repository.ts";

describe("parseGithubRepository", () => {
  it.each([
    ["git+https://github.com/colinhacks/zod.git", "colinhacks", "zod"],
    ["https://github.com/colinhacks/zod", "colinhacks", "zod"],
    ["git://github.com/colinhacks/zod.git", "colinhacks", "zod"],
    ["git+ssh://git@github.com/colinhacks/zod.git", "colinhacks", "zod"],
    ["git@github.com:colinhacks/zod.git", "colinhacks", "zod"],
    ["github:colinhacks/zod", "colinhacks", "zod"],
    ["colinhacks/zod", "colinhacks", "zod"],
  ])("распознаёт форму %s", (value, owner, repo) => {
    expect(parseGithubRepository(value)).toEqual({ owner, repo });
  });

  it("возвращает undefined для репозитория не на GitHub", () => {
    expect(parseGithubRepository("https://gitlab.com/colinhacks/zod")).toBeUndefined();
  });

  it("возвращает undefined для нераспознаваемой строки", () => {
    expect(parseGithubRepository("не url и не owner/repo!")).toBeUndefined();
  });
});

describe("repositoryDisplayUrl", () => {
  it("строит канонический https-URL для GitHub", () => {
    expect(repositoryDisplayUrl("git@github.com:colinhacks/zod.git", { owner: "colinhacks", repo: "zod" })).toBe(
      "https://github.com/colinhacks/zod",
    );
  });

  it("сохраняет не-GitHub URL как есть без префикса git+", () => {
    expect(repositoryDisplayUrl("git+https://gitlab.com/colinhacks/zod.git", undefined)).toBe(
      "https://gitlab.com/colinhacks/zod.git",
    );
  });
});
