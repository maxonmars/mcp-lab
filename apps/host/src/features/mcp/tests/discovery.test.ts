import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  class FakeSdkError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  class FakeTransport {
    readonly params: unknown;

    constructor(params: unknown) {
      this.params = params;
      state.transports.push(this);
    }

    start = (): Promise<void> => state.start(this);
  }

  const state = {
    clients: [] as FakeClient[],
    transports: [] as FakeTransport[],
    capabilities: { tools: {} } as unknown,
    server: { name: "filesystem", version: "1.2.3" } as unknown,
    start: async (_transport: FakeTransport) => {},
    connect: async (transport: FakeTransport, _options: unknown) => {
      await transport.start();
    },
    listTools: async (_options: unknown): Promise<unknown> => ({ tools: [] }),
    close: async (_client: FakeClient) => {},
    connectOptions: [] as unknown[],
    listOptions: [] as unknown[],
  };

  class FakeClient {
    readonly info: unknown;
    readonly options: unknown;

    constructor(info: unknown, options: unknown) {
      this.info = info;
      this.options = options;
      state.clients.push(this);
    }

    async connect(transport: FakeTransport, options: unknown): Promise<void> {
      state.connectOptions.push(options);
      await state.connect(transport, options);
    }

    getServerCapabilities = (): unknown => state.capabilities;

    getServerVersion = (): unknown => state.server;

    async listTools(_params: unknown, options: unknown): Promise<unknown> {
      state.listOptions.push(options);
      return state.listTools(options);
    }

    async close(): Promise<void> {
      await state.close(this);
    }
  }

  return {
    Client: FakeClient,
    SdkError: FakeSdkError,
    SdkErrorCode: { RequestTimeout: "REQUEST_TIMEOUT" },
    StdioClientTransport: FakeTransport,
    state,
  };
});

vi.mock("@modelcontextprotocol/client", () => ({
  Client: sdk.Client,
  SdkError: sdk.SdkError,
  SdkErrorCode: sdk.SdkErrorCode,
}));
vi.mock("@modelcontextprotocol/client/stdio", () => ({ StdioClientTransport: sdk.StdioClientTransport }));

import { discoverFilesystemTools, type McpDiscoveryError } from "../index.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-lab-discovery-"));
  resetSdk();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

function resetSdk(): void {
  sdk.state.clients.length = 0;
  sdk.state.transports.length = 0;
  sdk.state.capabilities = { tools: {} };
  sdk.state.server = { name: "filesystem", version: "1.2.3" };
  sdk.state.start = async () => {};
  sdk.state.connect = async (transport) => {
    await transport.start();
  };
  sdk.state.listTools = async () => ({ tools: [] });
  sdk.state.close = async () => {};
  sdk.state.connectOptions.length = 0;
  sdk.state.listOptions.length = 0;
}

function discover(timeoutMs = 23) {
  return discoverFilesystemTools({ root, timeoutMs, nodeExecutable: "node-for-test" });
}

async function expectError(
  operation: Promise<unknown>,
  code: McpDiscoveryError["code"],
  stage?: McpDiscoveryError["stage"],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code, stage });
}

function timeoutAfter(timeout: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new sdk.SdkError(sdk.SdkErrorCode.RequestTimeout)), timeout);
  });
}

describe("discoverFilesystemTools", () => {
  it("возвращает сведения сервера и список, полученные от SDK", async () => {
    const close = vi.fn(async () => {});
    sdk.state.close = close;
    sdk.state.listTools = async () => ({
      tools: [{ name: "read", description: "Read a file" }, { name: "list" }],
    });
    const result = await discover();
    const client = sdk.state.clients[0];
    const transport = sdk.state.transports[0];
    expect(result).toEqual({
      server: { name: "filesystem", version: "1.2.3" },
      tools: [{ name: "read", description: "Read a file" }, { name: "list" }],
    });
    expect(client?.info).toEqual({ name: "mcp-lab-host", version: "0.1.0" });
    expect(client?.options).toEqual({
      versionNegotiation: { mode: "legacy" },
      supportedProtocolVersions: ["2025-11-25"],
    });
    expect(transport?.params).toMatchObject({
      command: "node-for-test",
      args: [expect.stringContaining("server-filesystem/dist/index.js"), root],
      stderr: "ignore",
    });
    expect(sdk.state.connectOptions).toEqual([{ timeout: 23 }]);
    expect(sdk.state.listOptions).toEqual([{ timeout: 23 }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("при поддержке tools возвращает пустой список", async () => {
    await expect(discover()).resolves.toMatchObject({ tools: [] });
    expect(sdk.state.listOptions).toEqual([{ timeout: 23 }]);
  });

  it("останавливается до listTools, если сервер не объявил tools", async () => {
    sdk.state.capabilities = {};
    await expectError(discover(), "TOOLS_UNSUPPORTED");
    expect(sdk.state.listOptions).toEqual([]);
    expect(sdk.state.clients).toHaveLength(1);
  });

  it("не запускает сервер для отсутствующей папки или обычного файла", async () => {
    await expectError(
      discoverFilesystemTools({ root: join(root, "missing"), timeoutMs: 1, nodeExecutable: "node" }),
      "ROOT_NOT_FOUND",
    );
    writeFileSync(join(root, "file.txt"), "fixture");
    await expectError(
      discoverFilesystemTools({ root: join(root, "file.txt"), timeoutMs: 1, nodeExecutable: "node" }),
      "ROOT_NOT_DIRECTORY",
    );
    await expectError(
      discoverFilesystemTools({ root: "relative-root", timeoutMs: 1, nodeExecutable: "node" }),
      "ROOT_CHECK_FAILED",
    );
    expect(sdk.state.clients).toEqual([]);
    expect(sdk.state.transports).toEqual([]);
  });

  it.each(["ENOENT", "ERR_INVALID_ARG_VALUE"])("сообщает об ошибке запуска с кодом %s", async (code) => {
    sdk.state.start = async () => {
      const error = new Error("spawn failed");
      Object.assign(error, { code });
      throw error;
    };
    await expectError(discover(), "SERVER_START_FAILED");
    expect(sdk.state.transports).toHaveLength(1);
  });

  it("переводит ошибку инициализации в CONNECT_FAILED", async () => {
    sdk.state.connect = async (transport) => {
      await transport.start();
      throw new Error("initialize rejected");
    };
    await expectError(discover(), "CONNECT_FAILED");
  });

  it("переводит ошибку списка в LIST_TOOLS_FAILED", async () => {
    sdk.state.listTools = async () => {
      throw new Error("tools rejected");
    };
    await expectError(discover(), "LIST_TOOLS_FAILED");
  });

  it("ограничивает ожидание подключения таймаутом SDK", async () => {
    let reached: (() => void) | undefined;
    const connected = new Promise<void>((resolve) => {
      reached = resolve;
    });
    sdk.state.connect = async (transport, options) => {
      await transport.start();
      vi.useFakeTimers();
      reached?.();
      const timeout = (options as { timeout: number }).timeout;
      await timeoutAfter(timeout);
    };
    const operation = discover(17);
    const assertion = expectError(operation, "TIMEOUT", "connect");
    await connected;
    await vi.advanceTimersByTimeAsync(17);
    await assertion;
    expect(sdk.state.connectOptions).toEqual([{ timeout: 17 }]);
  });

  it("ограничивает ожидание списка таймаутом SDK", async () => {
    let reached: (() => void) | undefined;
    const listed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    sdk.state.listTools = async (options) => {
      vi.useFakeTimers();
      reached?.();
      const timeout = (options as { timeout: number }).timeout;
      return timeoutAfter(timeout);
    };
    const operation = discover(19);
    const assertion = expectError(operation, "TIMEOUT", "listTools");
    await listed;
    await vi.advanceTimersByTimeAsync(19);
    await assertion;
    expect(sdk.state.listOptions).toEqual([{ timeout: 19 }]);
  });

  it("закрывает клиент после ошибки и сохраняет первичную причину", async () => {
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    sdk.state.close = close;
    sdk.state.listTools = async () => {
      throw new Error("list failed");
    };
    await expectError(discover(), "LIST_TOOLS_FAILED");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("возвращает CLOSE_FAILED, если успешно завершённая операция не закрылась", async () => {
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    sdk.state.close = close;
    await expectError(discover(), "CLOSE_FAILED");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
