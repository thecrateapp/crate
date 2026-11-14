import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

const webSrc = fileURLToPath(new URL("../web/src", import.meta.url));

export default defineConfig({
  site: "https://ryoku.cratemusic.app",
  trailingSlash: "never",
  build: { format: "file" },
  server: { allowedHosts: [".dev.cratemusic.app"] },
  vite: {
    resolve: {
      alias: {
        "@crate-web": webSrc,
        // tokens.css imports this from app/web, which has no node_modules in this build.
        "@fontsource/jetbrains-mono": fileURLToPath(
          new URL("./node_modules/@fontsource/jetbrains-mono", import.meta.url),
        ),
      },
    },
    server: {
      fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), webSrc] },
    },
  },
});
