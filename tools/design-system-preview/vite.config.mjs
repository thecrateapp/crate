import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
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
      transform(code, id) {
        if (
          id ===
          fileURLToPath(
            new URL(
              "../../app/ui/src/pages/PlaylistEditor.tsx",
              import.meta.url,
            ),
          )
        )
          return {
            code: `import { EditorEventSource as EventSource } from ${JSON.stringify(
              fileURLToPath(
                new URL("admin-playlist-editor-fixtures.ts", import.meta.url),
              ),
            )};\n${code}`,
            map: null,
          };
      },
      resolveId(source, importer) {
        if (importer?.endsWith("/app/ui/src/pages/PlaylistEditor.tsx")) {
          if (
            ["@/lib/api", "@/hooks/use-api", "@/hooks/use-llm"].includes(source)
          )
            return fileURLToPath(
              new URL("admin-playlist-editor-fixtures.ts", import.meta.url),
            );
          if (source === "@/components/ui/AIButton")
            return (
              fileURLToPath(
                new URL(
                  "../../app/ui/src/components/ui/AIButton.tsx",
                  import.meta.url,
                ),
              ) + "?editor-preview"
            );
        }
        if (
          importer?.endsWith(
            "/app/ui/src/components/ui/AIButton.tsx?editor-preview",
          ) &&
          source === "@/hooks/use-llm"
        )
          return fileURLToPath(
            new URL("admin-playlist-editor-fixtures.ts", import.meta.url),
          );
        if (
          (importer?.endsWith("/app/ui/src/pages/Playlists.tsx") &&
            source === "@/lib/api") ||
          (importer?.endsWith(
            "/app/ui/src/components/playlists/PlaylistArtwork.tsx",
          ) &&
            source === "@/lib/library-routes")
        )
          return fileURLToPath(
            new URL("admin-playlists-fixtures.ts", import.meta.url),
          );
        if (
          (importer?.endsWith("/app/ui/src/pages/Upcoming.tsx") &&
            source === "@/lib/api") ||
          (importer?.endsWith("/app/ui/src/components/shows/ShowCard.tsx") &&
            source === "@/lib/library-routes")
        )
          return fileURLToPath(
            new URL("admin-upcoming-fixtures.ts", import.meta.url),
          );
        if (!importer?.includes("/app/ui/") || !source.startsWith("@/")) return;
        if (
          importer.endsWith("/app/ui/src/pages/I18nReview.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-translations-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Users.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-users-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Roles.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-roles-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/GlobalCatalog.tsx") &&
          ["@/lib/api", "@/hooks/use-api"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-global-catalog-fixtures.ts", import.meta.url),
          );
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
        review1bdSettingsRemaining: fileURLToPath(
          new URL("review-1bd-settings-remaining.html", import.meta.url),
        ),
        review1bdSettings: fileURLToPath(
          new URL("review-1bd-settings.html", import.meta.url),
        ),
        radioPathsReview: fileURLToPath(
          new URL("review-1bc-radio-paths.html", import.meta.url),
        ),
        upcomingShows1bc: resolve(
          import.meta.dirname,
          "review-1bc-upcoming-shows.html",
        ),
        artist1bc: resolve(import.meta.dirname, "review-1bc-artist.html"),
        menus1bc: fileURLToPath(
          new URL("review-1bc-menus.html", import.meta.url),
        ),
        exploreBrowse1bc: resolve(
          import.meta.dirname,
          "review-1bc-explore.html",
        ),
        catalogSearch1bb: fileURLToPath(
          new URL("review-1bb-catalog-search.html", import.meta.url),
        ),
        review1BBDetails: fileURLToPath(
          new URL("review-1bb-collection-details.html", import.meta.url),
        ),
        review1BB: fileURLToPath(
          new URL("review-1bb-home-library.html", import.meta.url),
        ),
        review1BAArtistPlayer: resolve(
          fileURLToPath(new URL(".", import.meta.url)),
          "review-1ba-artist-player.html",
        ),
        review1BAPlayerMotion: fileURLToPath(
          new URL("review-1ba-player-motion.html", import.meta.url),
        ),
        review1BA: fileURLToPath(
          new URL("review-1ba-album-access.html", import.meta.url),
        ),
        review1azPlayer: fileURLToPath(
          new URL("review-1az-player.html", import.meta.url),
        ),
        review1ayShell: fileURLToPath(
          new URL("review-1ay-shell.html", import.meta.url),
        ),
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        review1axLayers: fileURLToPath(
          new URL("review-1ax-layers.html", import.meta.url),
        ),
        review1awCollections: fileURLToPath(
          new URL("review-1aw-collections.html", import.meta.url),
        ),
        review1avImages: fileURLToPath(
          new URL("review-1av-images.html", import.meta.url),
        ),
        review1auHeaders: fileURLToPath(
          new URL("review-1au-headers.html", import.meta.url),
        ),
        review1atSurfaces: fileURLToPath(
          new URL("review-1at-surfaces.html", import.meta.url),
        ),
        review1asActions: fileURLToPath(
          new URL("review-1as-actions.html", import.meta.url),
        ),
        review1arLabels: fileURLToPath(
          new URL("review-1ar-labels.html", import.meta.url),
        ),
        review1arForms: fileURLToPath(
          new URL("review-1ar-forms.html", import.meta.url),
        ),
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
        adminPlaylists: fileURLToPath(
          new URL("admin-playlists-demo.html", import.meta.url),
        ),
        badgeNormalization: fileURLToPath(
          new URL("badge-normalization-demo.html", import.meta.url),
        ),
        adminPlaylistEditor: fileURLToPath(
          new URL("admin-playlist-editor-demo.html", import.meta.url),
        ),
        adminUpcoming: fileURLToPath(
          new URL("admin-upcoming-demo.html", import.meta.url),
        ),
        adminTranslations: fileURLToPath(
          new URL("admin-translations-demo.html", import.meta.url),
        ),
        adminUsers: fileURLToPath(
          new URL("admin-users-demo.html", import.meta.url),
        ),
        adminRoles: fileURLToPath(
          new URL("admin-roles-demo.html", import.meta.url),
        ),
        adminGlobalCatalog: fileURLToPath(
          new URL("admin-global-catalog-demo.html", import.meta.url),
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
