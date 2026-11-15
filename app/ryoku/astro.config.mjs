import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

const webSrc = fileURLToPath(new URL("../web/src", import.meta.url));

export default defineConfig({
  site: "https://ryoku.cratemusic.app",
  trailingSlash: "never",
  build: { format: "file" },
  server: { allowedHosts: [".dev.cratemusic.app"] },
  vite: {
    // Vite would read app/web/tsconfig.json for files under the alias; it extends a
    // package app/web has no node_modules for here. One project tsconfig for all files.
    tsconfig: "./tsconfig.json",
    resolve: {
      // app/web's motion scripts import these; resolve them from this app's node_modules.
      dedupe: ["gsap", "lenis"],
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
