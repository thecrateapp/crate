import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiUrl: (path: string) => `https://crate.test${path}`,
}));

vi.mock("@/lib/platform", () => ({
  getListenAppId: () => "listen-web",
  isTauriRuntime: false,
  usesConfigurableServer: false,
}));

import {
  findUnsupportedLocaleRequestCandidate,
  markUnsupportedLocaleRequested,
  requestUnsupportedLocaleTranslation,
  shouldRequestUnsupportedLocale,
} from "@/i18n/translation-request";

function response(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  } as Response;
}

describe("translation request dedupe", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("requests an unsupported locale once per source version", () => {
    expect(shouldRequestUnsupportedLocale("pl-PL", "sha256:a")).toBe(true);
    markUnsupportedLocaleRequested("pl-PL", "sha256:a");
    expect(shouldRequestUnsupportedLocale("pl-PL", "sha256:a")).toBe(false);
    expect(shouldRequestUnsupportedLocale("pl-PL", "sha256:b")).toBe(true);
  });

  it("only selects a candidate when every browser language is unsupported", () => {
    expect(findUnsupportedLocaleRequestCandidate(["pl-PL"])).toEqual({
      detectedLocale: "pl-PL",
      normalizedLocale: "pl",
    });
    expect(
      findUnsupportedLocaleRequestCandidate(["pl-PL", "en-US"]),
    ).toBeNull();
  });

  it("marks the request only after the backend accepts it", async () => {
    const fetchMock = vi.fn(async () => response(202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestUnsupportedLocaleTranslation("pl-PL", "sha256:a"),
    ).resolves.toBe(true);

    expect(shouldRequestUnsupportedLocale("pl-PL", "sha256:a")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crate.test/api/i18n/listen/translation-requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          detectedLocale: "pl-PL",
          normalizedLocale: "pl",
          sourceVersion: "sha256:a",
          client: "listen-web",
          reason: "unsupported-locale",
        }),
      }),
    );
  });

  it("keeps the request pending when the backend rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(500)),
    );

    await expect(
      requestUnsupportedLocaleTranslation("pl-PL", "sha256:a"),
    ).resolves.toBe(false);

    expect(shouldRequestUnsupportedLocale("pl-PL", "sha256:a")).toBe(true);
  });
});
