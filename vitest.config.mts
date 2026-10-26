import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    env: {
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      PGLITE_DIR: "memory://",
      DATABASE_URL: "",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});
