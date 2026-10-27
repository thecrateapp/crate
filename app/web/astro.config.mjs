import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cratemusic.app",
  trailingSlash: "never",
  build: { format: "file" },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    resolve: {
      alias: {
        "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      },
    },
  },
});
