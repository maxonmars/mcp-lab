import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GITHUB_API_TIMEOUT_MS } from "../github/constants.ts";
import { createGithubReleasesServer } from "../index.ts";

serveStdio(() => createGithubReleasesServer({ fetchImpl: fetch, timeoutMs: GITHUB_API_TIMEOUT_MS }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
