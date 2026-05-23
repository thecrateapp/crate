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
  appType: "spa",
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
    },
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        inline: ["lucide-react"],
      },
    },
  },
  server: {
    allowedHosts: [
      ".crate.local",
      ".dev.lespedants.org",
      ".dev.cratemusic.app",
      "www.dev.cratemusic.app",
      ".cratemusic.app",
    ],
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
