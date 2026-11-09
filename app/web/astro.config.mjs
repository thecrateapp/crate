import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import expressiveCode, { ExpressiveCodeTheme } from "astro-expressive-code";
import { defineConfig } from "astro/config";
import { crateSourceLinks } from "./src/lib/code-blocks.ts";
import { rehypeBlogLinks } from "./src/lib/blog-links.ts";

const crateTheme = ExpressiveCodeTheme.fromJSONString(
  readFileSync(new URL("./src/lib/code-theme.json", import.meta.url), "utf8"),
);

export default defineConfig({
  site: "https://cratemusic.app",
  trailingSlash: "never",
  server: { allowedHosts: [".dev.cratemusic.app"] },
  build: { format: "file" },
  markdown: { rehypePlugins: [rehypeBlogLinks] },
  integrations: [
    {
      name: "crate-isolated-vite-cache",
      hooks: {
        "astro:config:setup": ({ command, updateConfig }) => {
          // Check/build must not replace the dependency hashes served by a live preview.
          updateConfig({
            vite: {
              cacheDir: fileURLToPath(new URL(`./node_modules/.vite-${command}/`, import.meta.url)),
            },
          });
        },
      },
    },
    expressiveCode({
      themes: [crateTheme],
      plugins: [crateSourceLinks(), pluginLineNumbers()],
      defaultProps: { showLineNumbers: false },
      styleOverrides: {
        borderRadius: "6px",
        borderColor: "rgba(241, 245, 249, 0.1)",
        codeFontFamily: "var(--mono)",
        codeFontSize: "0.85rem",
        codeLineHeight: "1.65",
        codePaddingBlock: "1.1rem",
        codePaddingInline: "1.25rem",
        uiFontFamily: "var(--mono)",
        uiFontSize: "0.72rem",
        frames: {
          shadowColor: "transparent",
          editorTabBarBorderBottomColor: "rgba(241, 245, 249, 0.1)",
          tooltipSuccessBackground: "#06b6d4",
        },
        textMarkers: {
          markBackground: "rgba(103, 232, 249, 0.08)",
          markBorderColor: "#67e8f9",
        },
      },
    }),
  ],
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    plugins: [{
      name: "crate-content-vite-cache",
      config(config) {
        // Astro also starts an auxiliary Vite server while restarting dev.
        if (config.optimizeDeps?.noDiscovery && config.cacheDir) {
          return { cacheDir: `${config.cacheDir}-content` };
        }
      },
    }],
    resolve: {
      alias: {
        "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      },
    },
  },
});
