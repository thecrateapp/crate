import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

const nodeModulesDir = fs.existsSync(path.resolve(__dirname, "node_modules"))
  ? path.resolve(__dirname, "node_modules")
  : path.resolve(__dirname, "../../node_modules");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(nodeModulesDir, "react"),
      "react/jsx-runtime": path.resolve(nodeModulesDir, "react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(
        nodeModulesDir,
        "react/jsx-dev-runtime.js",
      ),
      "react-dom": path.resolve(nodeModulesDir, "react-dom"),
      "react-dom/client": path.resolve(nodeModulesDir, "react-dom/client.js"),
      "react-router": path.resolve(
        nodeModulesDir,
        "react-router/dist/development/index.mjs",
      ),
    },
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        inline: ["lucide-react", "react-markdown", "react-router"],
      },
    },
  },
  server: {
    allowedHosts: [
      ".crate.local",
      ".dev.lespedants.org",
      ".dev.cratemusic.app",
      ".cratemusic.app",
      "docs.dev.cratemusic.app",
      "docs.cratemusic.app",
      "docs.dev.lespedants.org",
      "docs.lespedants.org",
    ],
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
