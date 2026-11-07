import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { sentryVitePlugin } = vi.hoisted(() => ({
  sentryVitePlugin: vi.fn<(options: unknown) => unknown[]>(() => []),
}));

vi.mock("@sentry/vite-plugin", () => ({ sentryVitePlugin }));
vi.mock("@vitejs/plugin-react", () => ({ default: () => [] }));
vi.mock("@tailwindcss/vite", () => ({ default: () => [] }));

const appRoot = path.resolve(__dirname, "../..");

type RewriteSources = (
  source: string,
  map: unknown,
  context: { mapDir: string },
) => string;

describe("Listen Sentry source map upload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uploads source maps with repository-relative sources", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "test-token");
    vi.stubEnv("SENTRY_ORG", "ninja-development");
    vi.stubEnv("SENTRY_PROJECT", "crate-listen");

    await import("../../vite.config");

    const [options] = sentryVitePlugin.mock.calls[0] as [
      {
        sourcemaps: {
          filesToDeleteAfterUpload: string;
          rewriteSources: RewriteSources;
        };
      },
    ];
    const mapDir = path.join(appRoot, "dist", "assets");
    expect(options.sourcemaps.filesToDeleteAfterUpload).toBe("**/*.map");
    expect(
      options.sourcemaps.rewriteSources("../../src/lib/api.ts", {}, { mapDir }),
    ).toBe("../app/listen/src/lib/api.ts");
    expect(
      options.sourcemaps.rewriteSources(
        "../../../shared/web/api.ts",
        {},
        { mapDir },
      ),
    ).toBe("../app/shared/web/api.ts");
  });
});
