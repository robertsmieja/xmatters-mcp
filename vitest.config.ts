import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: "bun",
          include: ["tests/integration/**/*.test.ts"],
          env: { XMATTERS_TEST_RUNTIME: "bun" },
          testTimeout: 20000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov", "html"],
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
