import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const systemHealthFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-system-health-fixtures.ts",
    import.meta.url,
  ),
);
const catalogFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-catalog-fixtures.ts",
    import.meta.url,
  ),
);
const adminUseApi = fileURLToPath(
  new URL("../../../app/ui/src/hooks/use-api.ts", import.meta.url),
);
const discoveryFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-discovery-fixtures.ts",
    import.meta.url,
  ),
);
const insightsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-insights-fixtures.ts",
    import.meta.url,
  ),
);
const acquisitionFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-acquisition-fixtures.ts",
    import.meta.url,
  ),
);
const importsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-imports-fixtures.ts",
    import.meta.url,
  ),
);
const newReleasesFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-new-releases-fixtures.ts",
    import.meta.url,
  ),
);
const upcomingFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-upcoming-fixtures.ts",
    import.meta.url,
  ),
);
const bandcampFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-bandcamp-fixtures.ts",
    import.meta.url,
  ),
);
const globalCatalogFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-global-catalog-fixtures.ts",
    import.meta.url,
  ),
);
const playlistEditorFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-playlist-editor-fixtures.ts",
    import.meta.url,
  ),
);
const playlistsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-playlists-fixtures.ts",
    import.meta.url,
  ),
);
const usersRolesFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-users-roles-fixtures.ts",
    import.meta.url,
  ),
);
const settingsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-settings-fixtures.ts",
    import.meta.url,
  ),
);
const translationsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-translations-fixtures.ts",
    import.meta.url,
  ),
);
const federationFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-federation-fixtures.ts",
    import.meta.url,
  ),
);
const contributionsFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-contributions-fixtures.ts",
    import.meta.url,
  ),
);
const adminNavigationFixture = fileURLToPath(
  new URL(
    "../../design-system-preview/admin-navigation-fixtures.ts",
    import.meta.url,
  ),
);
const playlistEditorAIButton = fileURLToPath(
  new URL("../../../app/ui/src/components/ui/AIButton.tsx", import.meta.url),
);
const catalogReviewFixture = {
  name: "admin-catalog-review-fixtures",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    const importerPath = id.split(/[?#]/)[0]?.replaceAll("\\", "/") ?? id;
    const isFederation =
      importerPath.includes("app/ui/src/pages/Federation.tsx") ||
      importerPath.includes("app/ui/src/pages/federation/");
    const isContributions = importerPath.includes(
      "app/ui/src/pages/Contributions.tsx",
    );
    const isDiscovery = importerPath.includes("app/ui/src/pages/Discover.tsx");
    const isInsights = importerPath.includes("app/ui/src/pages/Insights.tsx");
    const isGenreWheel = importerPath.includes(
      "app/ui/src/components/genres/GenreWheel.tsx",
    );
    const isGenreExplorer = importerPath.includes(
      "app/ui/src/components/genres/GenreTaxonomyExplorer.tsx",
    );
    const isAcquisition = importerPath.includes(
      "app/ui/src/pages/Download.tsx",
    );
    const isImports = importerPath.includes("app/ui/src/pages/Imports.tsx");
    const isNewReleases = importerPath.includes(
      "app/ui/src/pages/NewReleases.tsx",
    );
    const isUpcomingPage = importerPath.includes(
      "app/ui/src/pages/Upcoming.tsx",
    );
    const isUpcomingShowCard = importerPath.includes(
      "app/ui/src/components/shows/ShowCard.tsx",
    );
    const isBandcamp = importerPath.includes("app/ui/src/pages/Bandcamp.tsx");
    const isGlobalCatalog = importerPath.includes(
      "app/ui/src/pages/GlobalCatalog.tsx",
    );
    const isPlaylistEditor = importerPath.includes(
      "app/ui/src/pages/PlaylistEditor.tsx",
    );
    const isPlaylists = importerPath.includes("app/ui/src/pages/Playlists.tsx");
    const isPlaylistArtwork = importerPath.includes(
      "app/ui/src/components/playlists/PlaylistArtwork.tsx",
    );
    const isUsersRolesPage =
      importerPath.includes("app/ui/src/pages/Users.tsx") ||
      importerPath.includes("app/ui/src/pages/Roles.tsx");
    const isPlaylistReviewScene = importerPath.includes(
      "tools/crate-ui-showcase/reviews/AdminPlaylistsReview.tsx",
    );
    const isPlaylistEditorAIButton =
      importerPath.includes("app/ui/src/components/ui/AIButton.tsx") &&
      id.includes("playlist-editor-review");
    const isAdminShell = importerPath.includes("app/ui/src/components/layout/");
    const shellImports = importerPath.endsWith("/Shell.tsx")
      ? ["@/hooks/use-notifications"]
      : importerPath.endsWith("/Sidebar.tsx")
        ? ["@/contexts/OpsSnapshotContext", "@/hooks/use-pending-approvals"]
        : importerPath.endsWith("/SearchBar.tsx") ||
            importerPath.endsWith("/CommandPalette.tsx")
          ? [
              "@/lib/api",
              ...(importerPath.endsWith("/CommandPalette.tsx")
                ? ["@/lib/task-catalog"]
                : []),
            ]
          : [];
    const imports = isFederation
      ? ["@/lib/api", "@/hooks/use-api"]
      : isContributions
        ? ["@/lib/api"]
        : isUsersRolesPage
          ? ["@/lib/api"]
          : isPlaylistReviewScene
            ? ["../../design-system-preview/admin-playlist-editor-fixtures"]
            : isPlaylistEditor
              ? [
                  "@/lib/api",
                  "@/hooks/use-api",
                  "@/hooks/use-llm",
                  "@/hooks/use-snapshot-stream",
                ]
              : isPlaylistEditorAIButton
                ? ["@/hooks/use-llm"]
                : isPlaylists
                  ? ["@/lib/api"]
                  : isPlaylistArtwork
                    ? ["@/lib/library-routes"]
                    : isImports
                      ? [
                          "@/lib/api",
                          "@/hooks/use-task-events",
                          "@/lib/library-routes",
                        ]
                      : isAcquisition
                        ? ["@/lib/api", "@/hooks/use-api"]
                        : isNewReleases
                          ? ["@/lib/api", "@/hooks/use-api", "@/lib/tasks"]
                          : isUpcomingPage
                            ? ["@/lib/api"]
                            : isBandcamp || isGlobalCatalog
                              ? ["@/lib/api", "@/hooks/use-api"]
                              : isUpcomingShowCard
                                ? ["@/lib/library-routes"]
                                : isDiscovery
                                  ? [
                                      "@/lib/api",
                                      "@/hooks/use-api",
                                      "@/hooks/use-task-poll",
                                    ]
                                  : isInsights
                                    ? ["@/hooks/use-api"]
                                    : isAdminShell
                                      ? shellImports
                                      : importerPath.includes(
                                            "app/ui/src/pages/Browse.tsx",
                                          )
                                        ? ["@/lib/api"]
                                        : isGenreWheel || isGenreExplorer
                                          ? ["@/hooks/use-api"]
                                          : importerPath.includes(
                                                "app/ui/src/pages/Genres.tsx",
                                              )
                                            ? [
                                                "@/lib/api",
                                                "@/hooks/use-api",
                                                "@/hooks/use-task-poll",
                                              ]
                                            : importerPath.includes(
                                                  "app/ui/src/components/artist/ArtistCard.tsx",
                                                ) ||
                                                importerPath.includes(
                                                  "app/ui/src/components/artist/ArtistRow.tsx",
                                                )
                                              ? ["@/lib/library-routes"]
                                              : [];
    if (imports.length === 0) return null;
    const fixture = isAdminShell
      ? adminNavigationFixture
      : isFederation
        ? federationFixture
        : isContributions
          ? contributionsFixture
          : isUsersRolesPage
            ? usersRolesFixture
            : isPlaylistEditor ||
                isPlaylistEditorAIButton ||
                isPlaylistReviewScene
              ? playlistEditorFixture
              : isPlaylists || isPlaylistArtwork
                ? playlistsFixture
                : isImports
                  ? importsFixture
                  : isAcquisition
                    ? acquisitionFixture
                    : isBandcamp
                      ? bandcampFixture
                      : isGlobalCatalog
                        ? globalCatalogFixture
                        : isNewReleases
                          ? newReleasesFixture
                          : isUpcomingPage || isUpcomingShowCard
                            ? upcomingFixture
                            : isDiscovery
                              ? discoveryFixture
                              : isInsights
                                ? insightsFixture
                                : catalogFixture;
    let transformed = code;
    for (const source of imports) {
      transformed = transformed.replaceAll(
        `from "${source}"`,
        `from "${fixture}"`,
      );
    }
    if (isPlaylistEditor)
      transformed = transformed.replaceAll(
        'from "@/components/ui/AIButton"',
        'from "@/components/ui/AIButton?playlist-editor-review"',
      );
    if (isGenreWheel)
      transformed = transformed.replaceAll(
        `from "/@fs${adminUseApi}"`,
        `from "${catalogFixture}"`,
      );
    if (transformed === code) return null;
    if (isAcquisition)
      transformed = `import { AcquisitionEventSource as EventSource } from ${JSON.stringify(
        acquisitionFixture,
      )};\n${transformed}`;
    if (isNewReleases)
      transformed = `import { SampleEventSource as EventSource } from ${JSON.stringify(
        newReleasesFixture,
      )};\n${transformed}`;
    return transformed;
  },
  resolveId(source: string, importer?: string) {
    const importerPath =
      importer?.split(/[?#]/)[0]?.replaceAll("\\", "/") ?? "";
    if (
      importerPath.endsWith("/app/ui/src/pages/SystemHealth.tsx") &&
      (source.endsWith("/hooks/use-api") ||
        source.endsWith("/hooks/use-api.ts") ||
        source.endsWith("/lib/task-catalog") ||
        source.endsWith("/lib/task-catalog.ts"))
    )
      return systemHealthFixture;
    if (
      importerPath.endsWith("/app/ui/src/components/genres/GenreWheel.tsx") &&
      (source.endsWith("/hooks/use-api") ||
        source.endsWith("/hooks/use-api.ts"))
    )
      return catalogFixture;
    if (
      importerPath.includes(
        "tools/crate-ui-showcase/reviews/AdminPlaylistsReview.tsx",
      ) &&
      source.includes("admin-playlist-editor-fixtures")
    )
      return playlistEditorFixture;
    if (
      (importerPath.includes("/app/ui/src/pages/Users.tsx") ||
        importerPath.includes("/app/ui/src/pages/Roles.tsx")) &&
      (source.endsWith("/lib/api") ||
        source.endsWith("/lib/api.ts") ||
        source.includes("/app/ui/src/lib/api.ts"))
    )
      return usersRolesFixture;
    if (importerPath.endsWith("/app/ui/src/pages/Settings.tsx")) {
      if (
        [
          "/hooks/use-api",
          "/lib/api",
          "/hooks/use-llm",
          "/contexts/OpsSnapshotContext",
          "/lib/task-catalog",
        ].some((suffix) => source.endsWith(suffix))
      )
        return settingsFixture;
    }
    if (importerPath.endsWith("/app/ui/src/pages/I18nReview.tsx")) {
      if (source.endsWith("/lib/api")) return translationsFixture;
      if (source.endsWith("/hooks/use-llm")) return settingsFixture;
    }
    if (importerPath.endsWith("/app/ui/src/pages/PlaylistEditor.tsx")) {
      if (
        [
          "/lib/api",
          "/hooks/use-api",
          "/hooks/use-llm",
          "/hooks/use-snapshot-stream",
        ].some((suffix) => source.endsWith(suffix))
      )
        return playlistEditorFixture;
      if (source.endsWith("/components/ui/AIButton"))
        return `${playlistEditorAIButton}?playlist-editor-review`;
    }
    if (
      importerPath.endsWith("/app/ui/src/components/ui/AIButton.tsx") &&
      importer?.includes("playlist-editor-review") &&
      source.endsWith("/hooks/use-llm")
    )
      return playlistEditorFixture;
    if (
      (importerPath.endsWith("/app/ui/src/pages/Playlists.tsx") &&
        source.endsWith("/lib/api")) ||
      (importerPath.endsWith(
        "/app/ui/src/components/playlists/PlaylistArtwork.tsx",
      ) &&
        source.endsWith("/lib/library-routes"))
    )
      return playlistsFixture;
    return null;
  },
};
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../docs/**/*.mdx", "../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  features: { sidebarOnboardingChecklist: false },
  staticDirs: [{ from: "../../../app/shared/fonts", to: "/crate-fonts" }],
  managerHead: (head) => `${head}
    <link rel="stylesheet" href="./crate-fonts/bricolage-grotesque.css">
    <link rel="stylesheet" href="./crate-fonts/roboto.css">
    <link rel="stylesheet" href="./crate-fonts/jetbrains-mono.css">`,
  async viteFinal(config) {
    config.plugins = [
      ...(config.plugins ?? []),
      catalogReviewFixture,
      tailwindcss(),
    ];
    const existingAliases = config.resolve?.alias;
    config.resolve = {
      ...config.resolve,
      alias: [
        {
          find: /^@\//,
          replacement: `${fileURLToPath(
            new URL("../../../app/ui/src", import.meta.url),
          )}/`,
        },
        ...(Array.isArray(existingAliases)
          ? existingAliases
          : Object.entries(existingAliases ?? {}).map(
              ([find, replacement]) => ({
                find,
                replacement,
              }),
            )),
      ],
    };
    // Storybook already supplies all story/annotation entries; release cold-start deps
    // without waiting on the virtual preview import crawl (Vite8 middleware mode).
    config.optimizeDeps = { ...config.optimizeDeps, holdUntilCrawlEnd: false };
    config.server = {
      ...config.server,
      fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
    };
    return config;
  },
};
export default config;
