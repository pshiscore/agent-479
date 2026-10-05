import { defineConfig } from "vitest/config";
import path from "node:path";

export const sharedConfig = {
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
};

// Unit tests: no network, no database. DB tests live in tests/db and run
// separately via `npm run test:db` (vitest.db.config.mts).
export default defineConfig({
  ...sharedConfig,
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/db/**", "node_modules/**"],
    // Every date/time test must pass regardless of the machine's local zone.
    env: { TZ: "UTC" },
  },
});
