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
            new URL("../../app/ui/src/pages/Download.tsx", import.meta.url),
          )
        )
          return {
            code: `import { AcquisitionEventSource as EventSource } from ${JSON.stringify(
              fileURLToPath(
                new URL("admin-acquisition-fixtures.ts", import.meta.url),
              ),
            )};\n${code}`,
            map: null,
          };
      },
      resolveId(source, importer) {
        if (
          (importer?.endsWith("/app/ui/src/pages/Federation.tsx") ||
            importer?.includes("/app/ui/src/pages/federation/")) &&
          ["@/lib/api", "@/hooks/use-api"].includes(source)
        )
          return fileURLToPath(
            new URL("admin-federation-fixtures.ts", import.meta.url),
          );
        if (importer?.endsWith("/app/ui/src/pages/Imports.tsx")) {
          if (
            [
              "@/lib/api",
              "@/hooks/use-task-events",
              "@/lib/library-routes",
            ].includes(source)
          )
            return fileURLToPath(
              new URL("admin-imports-fixtures.ts", import.meta.url),
            );
        }
        if (importer?.endsWith("/app/ui/src/pages/Download.tsx")) {
          if (["@/lib/api", "@/hooks/use-api"].includes(source))
            return fileURLToPath(
              new URL("admin-acquisition-fixtures.ts", import.meta.url),
            );
        }
        if (
          importer?.endsWith("/app/ui/src/pages/Browse.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-catalog-fixtures.ts", import.meta.url),
          );
        if (
          importer?.endsWith("/app/ui/src/pages/Genres.tsx") &&
          ["@/lib/api", "@/hooks/use-api", "@/hooks/use-task-poll"].includes(
            source,
          )
        )
          return fileURLToPath(
            new URL("admin-catalog-fixtures.ts", import.meta.url),
          );
        if (
          importer?.includes("/app/ui/src/components/genres/") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-catalog-fixtures.ts", import.meta.url),
          );
        if (
          [
            "/app/ui/src/components/artist/ArtistCard.tsx",
            "/app/ui/src/components/artist/ArtistRow.tsx",
          ].some((file) => importer?.endsWith(file)) &&
          source === "@/lib/library-routes"
        )
          return fileURLToPath(
            new URL("admin-catalog-fixtures.ts", import.meta.url),
          );
        if (importer?.endsWith("/app/ui/src/pages/PlaylistEditor.tsx")) {
          if (
            [
              "@/lib/api",
              "@/hooks/use-api",
              "@/hooks/use-llm",
              "@/hooks/use-snapshot-stream",
            ].includes(source)
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
        if (importer.endsWith("/app/ui/src/pages/I18nReview.tsx")) {
          if (source === "@/lib/api")
            return fileURLToPath(
              new URL("admin-translations-fixtures.ts", import.meta.url),
            );
          if (source === "@/hooks/use-llm")
            return fileURLToPath(
              new URL("admin-settings-fixtures.ts", import.meta.url),
            );
        }
        if (
          importer.endsWith("/app/ui/src/pages/Settings.tsx") &&
          [
            "@/hooks/use-api",
            "@/lib/api",
            "@/hooks/use-llm",
            "@/contexts/OpsSnapshotContext",
            "@/lib/task-catalog",
          ].includes(source)
        )
          return fileURLToPath(
            new URL("admin-settings-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Users.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-users-roles-fixtures.ts", import.meta.url),
          );
        if (
          importer.endsWith("/app/ui/src/pages/Roles.tsx") &&
          source === "@/lib/api"
        )
          return fileURLToPath(
            new URL("admin-users-roles-fixtures.ts", import.meta.url),
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
          importer.endsWith("/app/ui/src/pages/Insights.tsx") &&
          source === "@/hooks/use-api"
        )
          return fileURLToPath(
            new URL("admin-insights-fixtures.ts", import.meta.url),
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
        review1BEContextMenus: fileURLToPath(
          new URL("review-1be-context-menus.html", import.meta.url),
        ),
        review1BEFontPairings: fileURLToPath(
          new URL("review-1be-font-pairings.html", import.meta.url),
        ),
        review1BEHomeSignals: fileURLToPath(
          new URL("review-1be-home-signals.html", import.meta.url),
        ),
        review1BEWebClosure: fileURLToPath(
          new URL("review-1be-web-closure.html", import.meta.url),
        ),
        review1BEPlayerEq: fileURLToPath(
          new URL("review-1be-player-eq.html", import.meta.url),
        ),
        review1BEVisualizer: fileURLToPath(
          new URL("review-1be-player-visualizer.html", import.meta.url),
        ),
        review1bePlayerOutput: fileURLToPath(
          new URL("review-1be-player-output.html", import.meta.url),
        ),
        review1bePlayerReading: fileURLToPath(
          new URL("review-1be-player-reading.html", import.meta.url),
        ),
        review1beStats: fileURLToPath(
          new URL("review-1be-stats.html", import.meta.url),
        ),
        review1bdOffline: fileURLToPath(
          new URL("review-1bd-offline.html", import.meta.url),
        ),
        review1bdSharingImports: fileURLToPath(
          new URL("review-1bd-sharing-imports.html", import.meta.url),
        ),
        review1bdActionLabels: fileURLToPath(
          new URL("review-1bd-action-labels.html", import.meta.url),
        ),
        review1bdCommunity: fileURLToPath(
          new URL("review-1bd-community.html", import.meta.url),
        ),
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
        review1bePrimaryHints: fileURLToPath(
          new URL("review-1be-primary-hints.html", import.meta.url),
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
        reviewAdminShell: fileURLToPath(
          new URL("review-admin-shell.html", import.meta.url),
        ),
        reviewAdminOperations: fileURLToPath(
          new URL("review-admin-operations.html", import.meta.url),
        ),
        reviewAdminTasks: fileURLToPath(
          new URL("review-admin-tasks.html", import.meta.url),
        ),
        reviewAdminHealthRecovery: fileURLToPath(
          new URL("review-admin-health-recovery.html", import.meta.url),
        ),
        reviewAdminCatalog: fileURLToPath(
          new URL("review-admin-catalog.html", import.meta.url),
        ),
        reviewAdminEntityRecovery: fileURLToPath(
          new URL("review-admin-entity-recovery.html", import.meta.url),
        ),
        reviewAdminPlaylists: fileURLToPath(
          new URL("review-admin-playlists.html", import.meta.url),
        ),
        reviewAdminUsersRoles: fileURLToPath(
          new URL("review-admin-users-roles.html", import.meta.url),
        ),
        reviewAdminSettingsTranslations: fileURLToPath(
          new URL("review-admin-settings-translations.html", import.meta.url),
        ),
        reviewAdminFederation: fileURLToPath(
          new URL("review-admin-federation.html", import.meta.url),
        ),
        reviewAdminAcquisition: fileURLToPath(
          new URL("admin-acquisition-demo.html", import.meta.url),
        ),
        reviewAdminImports: fileURLToPath(
          new URL("admin-imports-demo.html", import.meta.url),
        ),
        adminAnalysis: fileURLToPath(
          new URL("admin-analysis-demo.html", import.meta.url),
        ),
        adminInsights: fileURLToPath(
          new URL("admin-insights-demo.html", import.meta.url),
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
