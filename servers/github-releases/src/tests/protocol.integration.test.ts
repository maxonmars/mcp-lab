import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createGithubReleasesServer, GET_GITHUB_RELEASE_TOOL_NAME, LIST_GITHUB_RELEASES_TOOL_NAME } from "../index.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const release = {
  tag_name: "v4.6.5",
  name: "v4.6.5",
  published_at: "2026-09-13T23:25:34Z",
  prerelease: false,
  draft: false,
  html_url: "https://github.com/colinhacks/zod/releases/tag/v4.6.5",
  body: "Заметки.",
};

function fakeFetch(): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/releases")) return jsonResponse([release]);
    return jsonResponse(release);
  }) as typeof fetch;
}

let client: Client | undefined;
let handle: StdioServerHandle | undefined;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
});

async function connectedClient(fetchImpl: typeof fetch): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createGithubReleasesServer({ fetchImpl, timeoutMs: 1000 }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

describe("github-releases MCP server: протокольная интеграция", () => {
  it("согласует современную ревизию и объявляет два инструмента", async () => {
    const created = await connectedClient(fakeFetch());
    expect(created.getProtocolEra()).toBe("modern");
    const { tools } = await created.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [GET_GITHUB_RELEASE_TOOL_NAME, LIST_GITHUB_RELEASES_TOOL_NAME].sort(),
    );
  });

  it("list_github_releases возвращает text и structuredContent", async () => {
    const created = await connectedClient(fakeFetch());
    const result = await created.callTool({
      name: LIST_GITHUB_RELEASES_TOOL_NAME,
      arguments: { owner: "colinhacks", repo: "zod" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("v4.6.5") }]);
    expect(result.structuredContent).toMatchObject({ owner: "colinhacks", repo: "zod" });
  });

  it("get_github_release возвращает заметки релиза", async () => {
    const created = await connectedClient(fakeFetch());
    const result = await created.callTool({
      name: GET_GITHUB_RELEASE_TOOL_NAME,
      arguments: { owner: "colinhacks", repo: "zod", tag: "v4.6.5" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Заметки.") }]);
  });

  it("некорректные owner/repo/tag отклоняются схемой MCP до вызова GitHub API", async () => {
    const created = await connectedClient(fakeFetch());
    const badOwner = await created.callTool({
      name: LIST_GITHUB_RELEASES_TOOL_NAME,
      arguments: { owner: "-bad", repo: "zod" },
    });
    expect(badOwner.isError).toBe(true);
    const badRepo = await created.callTool({
      name: GET_GITHUB_RELEASE_TOOL_NAME,
      arguments: { owner: "colinhacks", repo: "..", tag: "v4.6.5" },
    });
    expect(badRepo.isError).toBe(true);
  });
});
