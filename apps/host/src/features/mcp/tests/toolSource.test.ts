import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clients: [] as unknown[],
  transports: [] as unknown[],
  capabilities: { tools: {} } as unknown,
  start: async (_transport: unknown) => {},
  connect: async (transport: { start: () => Promise<void> }, _options: unknown) => {
    await transport.start();
  },
  listTools: async (_options: unknown): Promise<unknown> => ({ tools: [] }),
  callTool: async (_params: unknown, _options: unknown): Promise<unknown> => ({
    content: [{ type: "text", text: "ok" }],
    isError: false,
  }),
  close: async (_client: unknown) => {},
  connectOptions: [] as unknown[],
  listOptions: [] as unknown[],
  callOptions: [] as unknown[],
  callParams: [] as unknown[],
}));

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
    async listTools(_params: unknown, options: unknown): Promise<unknown> {
      state.listOptions.push(options);
      return state.listTools(options);
    }
    async callTool(params: unknown, options: unknown): Promise<unknown> {
      state.callParams.push(params);
      state.callOptions.push(options);
      return state.callTool(params, options);
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
  };
});

vi.mock("@modelcontextprotocol/client", () => ({
  Client: sdk.Client,
  SdkError: sdk.SdkError,
  SdkErrorCode: sdk.SdkErrorCode,
}));
vi.mock("@modelcontextprotocol/client/stdio", () => ({ StdioClientTransport: sdk.StdioClientTransport }));

import type { ToolSource } from "../../../core/index.ts";
import { withStdioToolSource } from "../toolSource.ts";
import type { McpToolSourceError } from "../toolSourceErrors.ts";

function resetSdk(): void {
  state.clients.length = 0;
  state.transports.length = 0;
  state.capabilities = { tools: {} };
  state.start = async () => {};
  state.connect = async (transport) => {
    await transport.start();
  };
  state.listTools = async () => ({ tools: [] });
  state.callTool = async () => ({ content: [{ type: "text", text: "ok" }], isError: false });
  state.close = async () => {};
  state.connectOptions.length = 0;
  state.listOptions.length = 0;
  state.callOptions.length = 0;
  state.callParams.length = 0;
}

function run<T>(use: (source: ToolSource) => Promise<T>, timeoutMs = 23) {
  return withStdioToolSource({ command: "node-for-test", args: ["entry.js"], timeoutMs }, use);
}

async function expectError(
  operation: Promise<unknown>,
  code: McpToolSourceError["code"],
  stage?: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject(stage === undefined ? { code } : { code, stage });
}

describe("withStdioToolSource", () => {
  it("создаёт Client с modern negotiation и один Client/Transport на сессию", async () => {
    resetSdk();
    await run((source) => source.listTools());
    expect(state.clients).toHaveLength(1);
    expect(state.transports).toHaveLength(1);
    expect((state.clients[0] as { options: unknown }).options).toEqual({ versionNegotiation: { mode: "auto" } });
  });

  it("listTools сохраняет полную inputSchema", async () => {
    resetSdk();
    state.listTools = async () => ({
      tools: [{ name: "get_current_weather", description: "Погода.", inputSchema: { type: "object", properties: {} } }],
    });
    const tools = await run((source) => source.listTools());
    expect(tools).toEqual([
      { name: "get_current_weather", description: "Погода.", inputSchema: { type: "object", properties: {} } },
    ]);
  });

  it("callTool передаёт точные name и arguments с таймаутом", async () => {
    resetSdk();
    await run((source) => source.callTool({ name: "get_current_weather", arguments: { location: "Омск" } }));
    expect(state.callParams).toEqual([{ name: "get_current_weather", arguments: { location: "Омск" } }]);
    expect(state.callOptions).toEqual([{ timeout: 23 }]);
  });

  it("сохраняет isError результата", async () => {
    resetSdk();
    state.callTool = async () => ({ content: [{ type: "text", text: "не найдено" }], isError: true });
    const result = await run((source) => source.callTool({ name: "x", arguments: {} }));
    expect(result).toEqual({ content: "не найдено", isError: true });
  });

  it("детерминированно объединяет несколько text blocks", async () => {
    resetSdk();
    state.callTool = async () => ({
      content: [
        { type: "text", text: "первая часть" },
        { type: "text", text: "вторая часть" },
      ],
      isError: false,
    });
    const result = await run((source) => source.callTool({ name: "x", arguments: {} }));
    expect(result).toEqual({ content: "первая часть\nвторая часть", isError: false });
  });

  it("отклоняет unsupported content типом ошибки UNSUPPORTED_TOOL_RESULT", async () => {
    resetSdk();
    state.callTool = async () => ({ content: [{ type: "image", data: "..." }], isError: false });
    await expectError(
      run((source) => source.callTool({ name: "x", arguments: {} })),
      "UNSUPPORTED_TOOL_RESULT",
    );
  });

  it("пустой content тоже отклоняется как UNSUPPORTED_TOOL_RESULT", async () => {
    resetSdk();
    state.callTool = async () => ({ content: [], isError: false });
    await expectError(
      run((source) => source.callTool({ name: "x", arguments: {} })),
      "UNSUPPORTED_TOOL_RESULT",
    );
  });

  it.each(["ENOENT", "ERR_INVALID_ARG_VALUE"])("сообщает об ошибке запуска с кодом %s", async (code) => {
    resetSdk();
    state.start = async () => {
      const error = new Error("spawn failed");
      Object.assign(error, { code });
      throw error;
    };
    await expectError(
      run((source) => source.listTools()),
      "SERVER_START_FAILED",
    );
  });

  it("переводит ошибку инициализации в CONNECT_FAILED", async () => {
    resetSdk();
    state.connect = async (transport) => {
      await transport.start();
      throw new Error("initialize rejected");
    };
    await expectError(
      run((source) => source.listTools()),
      "CONNECT_FAILED",
    );
  });

  it("останавливается до listTools, если сервер не объявил tools", async () => {
    resetSdk();
    state.capabilities = {};
    await expectError(
      run((source) => source.listTools()),
      "TOOLS_UNSUPPORTED",
    );
    expect(state.listOptions).toEqual([]);
  });

  it("различает таймаут connect по stage", async () => {
    resetSdk();
    state.connect = async (transport) => {
      await transport.start();
      throw new sdk.SdkError(sdk.SdkErrorCode.RequestTimeout);
    };
    await expectError(
      run((source) => source.listTools()),
      "TIMEOUT",
      "connect",
    );
  });

  it("различает таймаут listTools по stage", async () => {
    resetSdk();
    state.listTools = async () => {
      throw new sdk.SdkError(sdk.SdkErrorCode.RequestTimeout);
    };
    await expectError(
      run((source) => source.listTools()),
      "TIMEOUT",
      "listTools",
    );
  });

  it("различает таймаут callTool по stage", async () => {
    resetSdk();
    state.callTool = async () => {
      throw new sdk.SdkError(sdk.SdkErrorCode.RequestTimeout);
    };
    await expectError(
      run((source) => source.callTool({ name: "x", arguments: {} })),
      "TIMEOUT",
      "callTool",
    );
  });

  it("закрывает Client после успеха", async () => {
    resetSdk();
    const close = vi.fn(async () => {});
    state.close = close;
    await run((source) => source.listTools());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("закрывает Client после ошибки и primary failure важнее close failure", async () => {
    resetSdk();
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    state.close = close;
    state.listTools = async () => {
      throw new Error("list failed");
    };
    await expectError(
      run((source) => source.listTools()),
      "LIST_TOOLS_FAILED",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ошибки use (например AgentError) проходят наружу без изменения типа, close всё равно вызывается", async () => {
    resetSdk();
    const close = vi.fn(async () => {});
    state.close = close;
    class FakeAgentError extends Error {
      readonly marker = "agent-error";
    }
    await expect(
      run(async () => {
        throw new FakeAgentError("boom");
      }),
    ).rejects.toBeInstanceOf(FakeAgentError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("самостоятельный close failure возвращается как CLOSE_FAILED", async () => {
    resetSdk();
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    state.close = close;
    await expectError(
      run((source) => source.listTools()),
      "CLOSE_FAILED",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
