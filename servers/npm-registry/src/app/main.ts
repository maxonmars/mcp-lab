import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createNpmRegistryServer } from "../index.ts";
import { NPM_REGISTRY_TIMEOUT_MS } from "../registry/constants.ts";

serveStdio(() => createNpmRegistryServer({ fetchImpl: fetch, timeoutMs: NPM_REGISTRY_TIMEOUT_MS }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
