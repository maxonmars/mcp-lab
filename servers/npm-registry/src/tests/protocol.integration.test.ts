import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createNpmRegistryServer, GET_NPM_PACKAGE_TOOL_NAME } from "../index.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const zodPayload = {
  name: "zod",
  version: "4.6.5",
  license: "MIT",
  homepage: "https://zod.dev",
  repository: { type: "git", url: "git+https://github.com/colinhacks/zod.git" },
};

function fakeFetch(status = 200): typeof fetch {
  return (async () => jsonResponse(zodPayload, status)) as typeof fetch;
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
  handle = serveStdio(() => createNpmRegistryServer({ fetchImpl, timeoutMs: 1000 }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

describe("npm-registry MCP server: протокольная интеграция", () => {
  it("согласует современную ревизию и объявляет ровно один инструмент", async () => {
    const created = await connectedClient(fakeFetch());
    expect(created.getProtocolEra()).toBe("modern");
    const { tools } = await created.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([GET_NPM_PACKAGE_TOOL_NAME]);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: "object",
      properties: { name: expect.objectContaining({ type: "string" }) },
      required: ["name"],
    });
  });

  it("успешный вызов возвращает text и structuredContent", async () => {
    const created = await connectedClient(fakeFetch());
    const result = await created.callTool({ name: GET_NPM_PACKAGE_TOOL_NAME, arguments: { name: "zod" } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("colinhacks, repo=zod") }]);
    expect(result.structuredContent).toMatchObject({ name: "zod", version: "4.6.5" });
  });

  it("некорректное имя отклоняется схемой MCP до вызова npm registry", async () => {
    const fetchImpl = fakeFetch();
    const created = await connectedClient(fetchImpl);
    const result = await created.callTool({ name: GET_NPM_PACKAGE_TOOL_NAME, arguments: { name: "../etc" } });
    expect(result.isError).toBe(true);
  });

  it("isError-результат при ошибке npm registry", async () => {
    const created = await connectedClient(fakeFetch(500));
    const result = await created.callTool({ name: GET_NPM_PACKAGE_TOOL_NAME, arguments: { name: "zod" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("registry") }]);
  });
});
