import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [],
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "lib/**/*.test.ts",
      "primitives/**/*.test.tsx",
      "shadcn/**/*.test.tsx",
      "composites/**/*.test.tsx",
      "domain/**/*.test.tsx",
    ],
    setupFiles: ["test-setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@crate\/ui\/(.+)$/,
        replacement: path.resolve(__dirname, "$1"),
      },
    ],
  },
});
