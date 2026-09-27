import { describe, expect, it, vi } from "vitest";
import { GITHUB_API_TIMEOUT_MS } from "../github/constants.ts";
import { getGithubRelease, listGithubReleases } from "../github/releases.ts";
import type { GithubApiDependencies } from "../github/types.ts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function deps(fetchImpl: typeof fetch): GithubApiDependencies {
  return { fetchImpl, timeoutMs: GITHUB_API_TIMEOUT_MS };
}

const release = {
  tag_name: "v4.6.5",
  name: "v4.6.5",
  published_at: "2026-09-13T23:25:34Z",
  prerelease: false,
  draft: false,
  html_url: "https://github.com/colinhacks/zod/releases/tag/v4.6.5",
};

describe("listGithubReleases", () => {
  it("запрашивает releases с per_page и заголовками GitHub API без токена", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([release]));
    await listGithubReleases("colinhacks", "zod", 5, deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const requested = new URL(String(url));
    expect(requested.origin + requested.pathname).toBe("https://api.github.com/repos/colinhacks/zod/releases");
    expect(requested.searchParams.get("per_page")).toBe("5");
    expect((init as RequestInit)?.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mcp-lab-github-releases",
    });
    expect((init as RequestInit)?.headers).not.toHaveProperty("Authorization");
  });

  it("пропускает черновики", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([release, { ...release, tag_name: "v4.7.0-draft", draft: true }]));
    const list = await listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl));
    expect(list.releases.map((item) => item.tag)).toEqual(["v4.6.5"]);
  });

  it("пустой список — не ошибка", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).resolves.toEqual({
      owner: "colinhacks",
      repo: "zod",
      releases: [],
    });
  });

  it("REPOSITORY_NOT_FOUND при 404 списка", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404));
    await expect(listGithubReleases("colinhacks", "нет-репозитория", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "REPOSITORY_NOT_FOUND",
    });
  });

  it("RATE_LIMITED при 429", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 429));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("RATE_LIMITED при 403 с x-ratelimit-remaining: 0", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403, { "x-ratelimit-remaining": "0" }));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("BAD_STATUS при 403 без исчерпанного лимита", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "BAD_STATUS",
    });
  });

  it("NETWORK_FAILED при исключении fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "NETWORK_FAILED",
    });
  });

  it("INVALID_PAYLOAD при невалидном JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 }));
    await expect(listGithubReleases("colinhacks", "zod", 10, deps(fetchImpl))).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });
});

describe("getGithubRelease", () => {
  it("запрашивает releases/tags/<tag> с закодированным тегом", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...release, body: "Заметки." }));
    await getGithubRelease("colinhacks", "zod", "v4.6.5", deps(fetchImpl));
    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.github.com/repos/colinhacks/zod/releases/tags/v4.6.5");
  });

  it("разбирает тело релиза и обрезает пробелы", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...release, body: "  Заметки.  " }));
    await expect(getGithubRelease("colinhacks", "zod", "v4.6.5", deps(fetchImpl))).resolves.toMatchObject({
      body: "Заметки.",
    });
  });

  it("RELEASE_NOT_FOUND при 404 тега", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404));
    await expect(getGithubRelease("colinhacks", "zod", "v0.0.0", deps(fetchImpl))).rejects.toMatchObject({
      code: "RELEASE_NOT_FOUND",
    });
  });

  it("INVALID_PAYLOAD без обязательных tag_name/html_url", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ name: "v4.6.5" }));
    await expect(getGithubRelease("colinhacks", "zod", "v4.6.5", deps(fetchImpl))).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
  });
});
