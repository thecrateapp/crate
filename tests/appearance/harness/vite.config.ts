import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(harnessRoot, "../../..");

export default defineConfig({
  root: harnessRoot,
  cacheDir: path.resolve(
    workspaceRoot,
    "node_modules/.vite-appearance-harness",
  ),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@crate/ui": path.resolve(workspaceRoot, "app/shared/ui"),
      "@": path.resolve(workspaceRoot, "app/listen/src"),
    },
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
});
