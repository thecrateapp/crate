import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [
    {
      name: "admin-navigation-preview-only",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.includes("/app/ui/") || !source.startsWith("@/")) return;
        if (
          importer.endsWith("/app/ui/src/pages/NewReleases.tsx") &&
          ["@/lib/api", "@/hooks/use-api", "@/lib/tasks"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-new-releases-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Discover.tsx") &&
          ["@/lib/api", "@/hooks/use-api", "@/hooks/use-task-poll"].includes(
            source,
          )
        )
          return fileURLToPath(
            new URL("admin-discovery-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Bandcamp.tsx") &&
          ["@/lib/api", "@/hooks/use-api"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-bandcamp-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Contributions.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-contributions-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Trash.tsx") &&
          ["@/lib/api", "@/lib/tasks"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-trash-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Health.tsx") &&
          ["@/lib/api", "@/hooks/use-task-events"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-health-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/SystemHealth.tsx") &&
          ["@/hooks/use-api", "@/lib/task-catalog"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-system-health-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Dashboard.tsx") &&
          ["@/lib/api", "@/contexts/OpsSnapshotContext"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-dashboard-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Analysis.tsx") &&
          ["@/lib/api", "@/contexts/OpsSnapshotContext"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-analysis-fixtures.ts", import.meta.url),
          );
        if (
          [
            "@/lib/api",
            "@/contexts/OpsSnapshotContext",
            "@/hooks/use-notifications",
          ].includes(source)
        )
          return fileURLToPath(
            new URL("admin-navigation-fixtures.ts", import.meta.url),
          );
        return this.resolve(
          resolve(
            fileURLToPath(new URL("../../app/ui/src", import.meta.url)),
            source.slice(2),
          ),
          importer,
          { skipSelf: true },
        );
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5186, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        adminNavigation: fileURLToPath(
          new URL("admin-navigation-demo.html", import.meta.url),
        ),
        adminAnalysis: fileURLToPath(
          new URL("admin-analysis-demo.html", import.meta.url),
        ),
        adminDashboard: fileURLToPath(
          new URL("admin-dashboard-demo.html", import.meta.url),
        ),
        adminSystemHealth: fileURLToPath(
          new URL("admin-system-health-demo.html", import.meta.url),
        ),
        adminHealth: fileURLToPath(
          new URL("admin-health-demo.html", import.meta.url),
        ),
        adminTrash: fileURLToPath(
          new URL("admin-trash-demo.html", import.meta.url),
        ),
        adminContributions: fileURLToPath(
          new URL("admin-contributions-demo.html", import.meta.url),
        ),
        adminNewReleases: fileURLToPath(
          new URL("admin-new-releases-demo.html", import.meta.url),
        ),
        adminDiscovery: fileURLToPath(
          new URL("admin-discovery-demo.html", import.meta.url),
        ),
        adminBandcamp: fileURLToPath(
          new URL("admin-bandcamp-demo.html", import.meta.url),
        ),
        retiredTimeline: fileURLToPath(
          new URL("admin-timeline-demo.html", import.meta.url),
        ),
        adminOperations: fileURLToPath(
          new URL("admin-operations-demo.html", import.meta.url),
        ),
        adminControls: fileURLToPath(
          new URL("admin-controls-demo.html", import.meta.url),
        ),
        skipLink: fileURLToPath(
          new URL("skip-link-demo.html", import.meta.url),
        ),
      },
    },
  },
});
