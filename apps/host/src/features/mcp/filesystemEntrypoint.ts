import { createRequire } from "node:module";

const requireFromHost = createRequire(new URL("../../../package.json", import.meta.url));

/** Путь к точке входа установленного пакета Filesystem MCP; резолвится через package.json host. */
export function resolveFilesystemEntrypoint(): string {
  return requireFromHost.resolve("@modelcontextprotocol/server-filesystem/dist/index.js");
}
