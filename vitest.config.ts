import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "engine", include: ["packages/engine/test/**/*.test.ts"], testTimeout: 120_000 } },
      { test: { name: "shared", include: ["packages/shared/test/**/*.test.ts"] } },
      { test: { name: "web", include: ["apps/studio/test/**/*.test.ts"] } },
      {
        test: {
          name: "api",
          include: ["apps/api/test/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
