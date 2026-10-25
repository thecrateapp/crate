import { defineConfig } from "vitest/config";
import path from "node:path";

process.env.LANG = "en_US.UTF-8";
process.env.LC_ALL = "en_US.UTF-8";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      exclude: ["src/test-setup.ts", "src/test/**", "**/*.test.{ts,tsx}"],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
