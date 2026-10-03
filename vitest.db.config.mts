import { defineConfig } from "vitest/config";
import { sharedConfig } from "./vitest.config.mjs";

// Integration tests against the real database (DATABASE_URL in .env.local).
// Every test runs inside a transaction that is always rolled back.
export default defineConfig({
  ...sharedConfig,
  test: {
    environment: "node",
    include: ["tests/db/**/*.db.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    env: { TZ: "UTC" },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
