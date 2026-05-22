import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "../shared/web/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      exclude: [
        "src/lib/gapless5/**",
        "src/test-setup.ts",
        "**/*.test.{ts,tsx}",
      ],
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
