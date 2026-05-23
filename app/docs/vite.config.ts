import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "../../node_modules/react/jsx-runtime.js",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "../../node_modules/react/jsx-dev-runtime.js",
      ),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
      "react-dom/client": path.resolve(
        __dirname,
        "../../node_modules/react-dom/client.js",
      ),
      "lucide-react": path.resolve(
        __dirname,
        "../../node_modules/lucide-react/dist/esm/lucide-react.mjs",
      ),
      "react-router": path.resolve(
        __dirname,
        "../../node_modules/react-router/dist/development/index.mjs",
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
