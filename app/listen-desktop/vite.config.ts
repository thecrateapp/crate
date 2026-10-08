import { createRequire } from "node:module";
import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const lodashEsRoot = path.dirname(require.resolve("lodash-es/package.json"));
const listenSrc = path.resolve(__dirname, "../listen/src");
const listenPublic = path.resolve(__dirname, "../listen/public");
const stubs = path.resolve(__dirname, "./src/lib/stubs");
const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
);
const sentryRelease =
  process.env.SENTRY_RELEASE ||
  (process.env.GITHUB_SHA ? `crate-${process.env.GITHUB_SHA}` : undefined);
const nativePerfTelemetryEnabled =
  process.env.CRATE_NATIVE_PERF_TELEMETRY === "1";

function nativePerfFsTelemetryPlugin(): Plugin {
  const virtualModuleId = "\0crate-native-perf:plugin-fs";
  const telemetryModuleId = path.resolve(
    __dirname,
    "scripts/native-perf/telemetry.js",
  );
  let nativeFsModuleId: string | undefined;

  return {
    name: "crate-native-perf-fs-telemetry",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source !== "@tauri-apps/plugin-fs") return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      nativeFsModuleId = resolved.id;
      return virtualModuleId;
    },
    load(id) {
      if (id !== virtualModuleId || !nativeFsModuleId) return null;
      const nativeFs = JSON.stringify(nativeFsModuleId);
      return `
        export * from ${nativeFs};
        import { writeTextFile as nativeWriteTextFile } from ${nativeFs};
        import { writeTextFileWithTelemetry } from ${JSON.stringify(
          telemetryModuleId,
        )};
        export function writeTextFile(path, data, options) {
          return writeTextFileWithTelemetry(nativeWriteTextFile, path, data, options);
        }
      `;
    },
  };
}

export default defineConfig({
  plugins: [
    ...(nativePerfTelemetryEnabled ? [nativePerfFsTelemetryPlugin()] : []),
    react(),
    tailwindcss(),
    ...(sentryUploadEnabled
      ? [
          ...sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: sentryRelease },
            sourcemaps: { filesToDeleteAfterUpload: "**/*.map" },
          }),
        ]
      : []),
  ],
  publicDir: listenPublic,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: sentryUploadEnabled,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/node_modules/@nivo/")) return "stats-vendor";
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": listenSrc,
      "@capacitor/app": path.resolve(stubs, "capacitor-app.ts"),
      "@capacitor/browser": path.resolve(stubs, "capacitor-browser.ts"),
      "@capacitor/core": path.resolve(stubs, "capacitor-core.ts"),
      "@capacitor/filesystem": path.resolve(stubs, "capacitor-filesystem.ts"),
      "@capacitor/haptics": path.resolve(stubs, "capacitor-haptics.ts"),
      "@capacitor/keyboard": path.resolve(stubs, "capacitor-keyboard.ts"),
      "@capacitor/network": path.resolve(stubs, "capacitor-network.ts"),
      "@capacitor/splash-screen": path.resolve(
        stubs,
        "capacitor-splash-screen.ts",
      ),
      "@capacitor/status-bar": path.resolve(stubs, "capacitor-status-bar.ts"),
      lodash: lodashEsRoot,
    },
    dedupe: ["@crate/ui", "react", "react-dom", "react-router"],
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
