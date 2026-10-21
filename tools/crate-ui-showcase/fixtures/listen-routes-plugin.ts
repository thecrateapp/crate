import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const fixture = fileURLToPath(
  new URL("./listen-library-routes.ts", import.meta.url),
);

/**
 * Hosts import Listen views directly and have no "@/" alias, so the explorer
 * panel's route helpers (which reach the API client) resolve to local fixtures.
 */
export function listenLibraryRoutesFixture(): Plugin {
  return {
    name: "listen-library-routes-fixture",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (
        importer?.endsWith(
          "/app/listen/src/components/stats/explorer/StatsExplorerPanel.tsx",
        ) &&
        source.endsWith("/lib/library-routes")
      )
        return fixture;
    },
  };
}
