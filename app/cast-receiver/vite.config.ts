import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vitest/config";

const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
);
const sentryRelease =
  process.env.SENTRY_RELEASE ||
  (process.env.GITHUB_SHA
    ? `cast-receiver-${process.env.GITHUB_SHA}`
    : undefined);

export default defineConfig({
  plugins: [
    react(),
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
  build: {
    sourcemap: sentryUploadEnabled,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/@sentry/")
            ? "sentry-observability"
            : undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
