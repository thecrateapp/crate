import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiUrl: (path: string) => `https://crate.test${path}`,
}));

vi.mock("@/lib/server-store", () => ({
  getCurrentServer: () => ({ id: "srv-1" }),
}));

import {
  buildI18nCacheKey,
  fetchPublishedRemoteBundle,
  readCachedBundle,
  writeCachedBundle,
} from "@/i18n/remote-bundles";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("remote i18n bundles", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keys bundles by server, locale, and source version", () => {
    expect(buildI18nCacheKey("srv-1", "es", "sha256:test")).toContain(
      "srv-1:es:sha256:test",
    );
  });

  it("round-trips a cached bundle", () => {
    writeCachedBundle("srv-1", "es", "sha256:test", {
      "player.play": "Reproducir",
    });

    expect(readCachedBundle("srv-1", "es", "sha256:test")).toEqual({
      "player.play": "Reproducir",
    });
  });

  it("fetches a published bundle when the source version matches", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/manifest")) {
        return jsonResponse({
          app: "listen",
          fallbackLocale: "en",
          sourceVersion: "sha256:test",
          bundles: [
            {
              locale: "es",
              sourceVersion: "sha256:test",
              bundleVersion: "2026.07.05.1",
            },
          ],
        });
      }
      return jsonResponse({
        schema: "crate.i18n.bundle.v1",
        app: "listen",
        locale: "es",
        sourceLocale: "en",
        sourceVersion: "sha256:test",
        bundleVersion: "2026.07.05.1",
        messages: { "player.play": "Dale" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublishedRemoteBundle("es", "sha256:test"),
    ).resolves.toEqual({
      "player.play": "Dale",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a bundle with a mismatched source version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/manifest")) {
          return jsonResponse({
            app: "listen",
            fallbackLocale: "en",
            sourceVersion: "sha256:test",
            bundles: [{ locale: "es", sourceVersion: "sha256:test" }],
          });
        }
        return jsonResponse({
          schema: "crate.i18n.bundle.v1",
          app: "listen",
          locale: "es",
          sourceLocale: "en",
          sourceVersion: "sha256:other",
          bundleVersion: "2026.07.05.1",
          messages: { "player.play": "Dale" },
        });
      }),
    );

    await expect(
      fetchPublishedRemoteBundle("es", "sha256:test"),
    ).resolves.toBeNull();
  });
});
