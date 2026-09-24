import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/tests/**/*.test.ts", "servers/**/tests/**/*.test.ts", "tooling/tests/**/*.test.ts"],
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      include: ["apps/host/src/**/*.ts", "servers/open-meteo/src/**/*.ts", "servers/scheduler/src/**/*.ts"],
      exclude: ["**/tests/**", "**/app/main.ts"],
      reporter: ["text", "html"],
    },
  },
});
