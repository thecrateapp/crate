import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("AppRouter mobile bundle boundary", () => {
  it("loads authenticated providers and shell behind a lazy boundary", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app-shell/AppRouter.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /lazy\(\(\)\s*=>\s*import\("@\/app-shell\/AuthenticatedApp"\)/,
    );
    expect(source).not.toContain(
      'import { AppProviders } from "@/app-shell/AppProviders"',
    );
    expect(source).not.toContain(
      'import { Shell } from "@/components/layout/Shell"',
    );

    const routeTableSource = readFileSync(
      path.join(process.cwd(), "src/app-shell/route-table.tsx"),
      "utf8",
    );
    expect(routeTableSource).toMatch(
      /React\.lazy\(\(\)\s*=>\s*import\("@\/pages\/Home"\)/,
    );
    expect(routeTableSource).not.toContain(
      'import { Home } from "@/pages/Home"',
    );

    const i18nProviderSource = readFileSync(
      path.join(process.cwd(), "src/i18n/I18nProvider.tsx"),
      "utf8",
    );
    expect(i18nProviderSource).not.toMatch(
      /import\s+\w+\s+from\s+"@\/i18n\/catalogs\//,
    );

    const catalogLoaderSource = readFileSync(
      path.join(process.cwd(), "src/i18n/catalog-loader.ts"),
      "utf8",
    );
    expect(catalogLoaderSource).toContain('import("@/i18n/catalogs/en.json")');
    expect(catalogLoaderSource).toContain('import("@/i18n/catalogs/es.json")');

    const mainSource = readFileSync(
      path.join(process.cwd(), "src/main.tsx"),
      "utf8",
    );
    expect(mainSource).not.toContain("refreshMediaAccessTickets");
  });

  it("keeps Solar icons behind feature entry points", () => {
    const iconDirectory = path.join(process.cwd(), "../shared/ui/icons");
    const featureEntries = [
      "actions.tsx",
      "media.tsx",
      "navigation.tsx",
      "people.tsx",
      "status.tsx",
      "system.tsx",
      "translation.tsx",
    ];

    for (const entry of featureEntries) {
      expect(existsSync(path.join(iconDirectory, entry))).toBe(true);
    }

    const iconIndex = readFileSync(
      path.join(iconDirectory, "index.tsx"),
      "utf8",
    );
    expect(iconIndex).not.toContain("@solar-icons/react-perf");
    expect(iconIndex).toContain('export * from "./media"');
    expect(iconIndex).toContain('export * from "./navigation"');

    const translationOverlay = readFileSync(
      path.join(
        process.cwd(),
        "src/i18n/translation-mode/TranslationOverlay.tsx",
      ),
      "utf8",
    );
    expect(translationOverlay).not.toContain("lucide-react");
    expect(translationOverlay).toContain("@crate/ui/icons/translation");

    const listenPackage = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(listenPackage.dependencies).not.toHaveProperty("lucide-react");
    expect(listenPackage.dependencies).not.toHaveProperty("iconoir-react");
    expect(listenPackage.dependencies).toHaveProperty("lodash-es", "^4.17.21");

    const viteConfig = readFileSync(
      path.join(process.cwd(), "vite.config.ts"),
      "utf8",
    );
    expect(viteConfig).toContain('replacement: "lodash-es/$1.js"');
    expect(viteConfig).not.toContain("createRequire");
  });
});
