import { describe, expect, it, vi } from "vitest";
import { fetchNpmPackage } from "../registry/package.ts";
import type { NpmRegistryDependencies } from "../registry/types.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(fetchImpl: typeof fetch): NpmRegistryDependencies {
  return { fetchImpl, timeoutMs: 1000 };
}

const fullPayload = {
  name: "zod",
  version: "4.6.5",
  description: "TypeScript-first schema validation",
  license: "MIT",
  homepage: "https://zod.dev",
  repository: { type: "git", url: "git+https://github.com/colinhacks/zod.git" },
};

describe("fetchNpmPackage", () => {
  it("запрашивает <name>/latest с Accept: application/json для обычного имени", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fullPayload));
    await fetchNpmPackage("zod", deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://registry.npmjs.org/zod/latest");
    expect((init as RequestInit)?.headers).toMatchObject({ Accept: "application/json" });
  });

  it("кодирует scoped-имя как @scope%2Fpkg/latest", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...fullPayload, name: "@types/node" }));
    await fetchNpmPackage("@types/node", deps(fetchImpl));
    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://registry.npmjs.org/@types%2Fnode/latest");
  });

  it("разбирает полный ответ с GitHub-репозиторием из { url }", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fullPayload));
    await expect(fetchNpmPackage("zod", deps(fetchImpl))).resolves.toEqual({
      name: "zod",
      version: "4.6.5",
      description: "TypeScript-first schema validation",
      license: "MIT",
      homepage: "https://zod.dev",
      repositoryUrl: "git+https://github.com/colinhacks/zod.git",
      repository: { owner: "colinhacks", repo: "zod" },
    });
  });

  it("принимает repository строкой и опускает отсутствующие необязательные поля", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ name: "left-pad", version: "1.3.0", repository: "stevemao/left-pad" }));
    await expect(fetchNpmPackage("left-pad", deps(fetchImpl))).resolves.toEqual({
      name: "left-pad",
      version: "1.3.0",
      repositoryUrl: "stevemao/left-pad",
      repository: { owner: "stevemao", repo: "left-pad" },
    });
  });

  it("PACKAGE_NOT_FOUND при 404", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchNpmPackage("нет-такого-пакета", deps(fetchImpl))).rejects.toMatchObject({
      code: "PACKAGE_NOT_FOUND",
    });
  });

  it("BAD_STATUS при прочих не-2xx", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 500));
    await expect(fetchNpmPackage("zod", deps(fetchImpl))).rejects.toMatchObject({ code: "BAD_STATUS" });
  });

  it("NETWORK_FAILED при исключении fetch, включая abort по таймауту", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchNpmPackage("zod", deps(fetchImpl))).rejects.toMatchObject({ code: "NETWORK_FAILED" });
  });

  it("INVALID_PAYLOAD при невалидном JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 }));
    await expect(fetchNpmPackage("zod", deps(fetchImpl))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("INVALID_PAYLOAD, если нет обязательных name/version", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ name: "zod" }));
    await expect(fetchNpmPackage("zod", deps(fetchImpl))).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});
