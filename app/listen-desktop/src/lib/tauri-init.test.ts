import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  dispatchOAuthCallbackResult,
  mergeInitialDeepLinkUrls,
  shouldUseTauriHttpPlugin,
} from "./tauri-init";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dispatchOAuthCallbackResult", () => {
  it("keeps a successful account link separate from login token events", () => {
    const completed = vi.fn();
    const authReceived = vi.fn();
    vi.stubGlobal("window", new EventTarget());
    window.addEventListener("crate:oauth-link-completed", completed);
    window.addEventListener("crate:auth-token-received", authReceived);

    dispatchOAuthCallbackResult({
      handled: true,
      next: "/settings",
      operation: "link",
      provider: "google",
      userId: 42,
    });

    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0]?.[0]).toMatchObject({
      detail: { provider: "google", userId: 42 },
    });
    expect(authReceived).not.toHaveBeenCalled();

    window.removeEventListener("crate:oauth-link-completed", completed);
    window.removeEventListener("crate:auth-token-received", authReceived);
  });

  it("reports link failures to the linking settings view", () => {
    const failed = vi.fn();
    vi.stubGlobal("window", new EventTarget());
    window.addEventListener("crate:oauth-link-failed", failed);

    dispatchOAuthCallbackResult({
      handled: true,
      next: "/settings",
      operation: "link",
      provider: "apple",
      userId: 42,
      error: true,
    });

    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { provider: "apple", userId: 42 },
      }),
    );
    window.removeEventListener("crate:oauth-link-failed", failed);
  });
});

describe("mergeInitialDeepLinkUrls", () => {
  it("preserves buffered callbacks and deduplicates launch URLs", () => {
    expect(
      mergeInitialDeepLinkUrls(
        ["cratemusic://oauth/callback?code=buffered"],
        [
          "cratemusic://oauth/callback?code=buffered",
          "cratemusic://oauth/callback?code=launch",
        ],
      ),
    ).toEqual([
      "cratemusic://oauth/callback?code=buffered",
      "cratemusic://oauth/callback?code=launch",
    ]);
  });
});

describe("shouldUseTauriHttpPlugin", () => {
  it("uses the privileged client for HTTPS servers", () => {
    expect(shouldUseTauriHttpPlugin("https://api.example.com/health")).toBe(
      true,
    );
  });

  it.each([
    "https://api.example.com/api/tracks/by-entity/track-1/stream?media_ticket=ticket",
    "https://api.example.com/api/catalog/tracks/track-1/stream",
    "https://api.example.com/api/playback/variants/variant-1/stream",
    "https://api.example.com/rest/stream.view?id=track-1",
  ])(
    "uses WebView fetch for media streams from a packaged Tauri origin: %s",
    (url) => {
      vi.stubGlobal("window", { location: { origin: "tauri://localhost" } });
      expect(shouldUseTauriHttpPlugin(url)).toBe(false);
    },
  );

  it("keeps media streams on the privileged client from the Vite dev origin", () => {
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:5178" },
    });
    expect(
      shouldUseTauriHttpPlugin(
        "https://api.example.com/api/tracks/by-entity/track-1/stream",
      ),
    ).toBe(true);
  });

  it.each([
    "http://localhost:8585/health",
    "http://127.0.0.1:8585/health",
    "http://[::1]:8585/health",
  ])("allows cleartext only for loopback URLs: %s", (url) => {
    expect(shouldUseTauriHttpPlugin(url)).toBe(true);
  });

  it("keeps arbitrary cleartext URLs out of the privileged client", () => {
    expect(shouldUseTauriHttpPlugin("http://api.example.com/health")).toBe(
      false,
    );
  });

  it("grants the same custom-port origins accepted by the runtime", () => {
    const capability = JSON.parse(
      readFileSync(
        new URL("../../src-tauri/capabilities/default.json", import.meta.url),
        "utf8",
      ),
    ) as {
      permissions: Array<
        string | { identifier: string; allow?: Array<{ url: string }> }
      >;
    };
    const httpScope = capability.permissions.find(
      (permission) =>
        typeof permission === "object" &&
        permission.identifier === "http:default",
    );
    const allowed =
      typeof httpScope === "object"
        ? httpScope.allow?.map((entry) => entry.url)
        : undefined;

    expect(allowed).toEqual(
      expect.arrayContaining([
        "https://*:*",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://[\\:\\:1]:*",
      ]),
    );
  });
});

describe("production asset protocol policy", () => {
  it("allows offline asset URLs to be fetched by WebAudio", () => {
    const config = JSON.parse(
      readFileSync(
        new URL("../../src-tauri/tauri.conf.json", import.meta.url),
        "utf8",
      ),
    ) as { app: { security: { csp: string } } };

    const connectSrc = config.app.security.csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src "));

    expect(connectSrc).toContain("asset:");
    expect(connectSrc).toContain("http://asset.localhost");
  });
});

describe("desktop appearance bootstrap", () => {
  it("uses the release appearance gate and renders a mode-aware toaster", () => {
    const source = readFileSync(
      new URL("../main.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "ignoreStoredPreferences: !LISTEN_APPEARANCE_SETTINGS_ENABLED",
    );
    expect(source).toContain("<ThemeAwareToaster />");
    expect(source).not.toContain('<Toaster theme="dark"');
  });

  it("waits for secure session and OAuth migration before enabling auth or rendering", () => {
    const mainSource = readFileSync(
      new URL("../main.tsx", import.meta.url),
      "utf8",
    );
    const initSource = readFileSync(
      new URL("./tauri-init.ts", import.meta.url),
      "utf8",
    );
    const orderedSteps = [
      "await bootstrapNativeSessionStore();",
      "await migrateLegacyTauriOAuthRecords();",
      "await migrateLegacyTauriLastfmRecord();",
      "startTauriOAuthRuntime();",
      "createRoot(root).render(",
    ].map((step) => mainSource.indexOf(step));

    expect(orderedSteps.every((index) => index >= 0)).toBe(true);
    expect(orderedSteps).toEqual(
      [...orderedSteps].sort((left, right) => left - right),
    );
    expect(initSource).toContain("export function startTauriOAuthRuntime");
    expect(
      initSource.split("export function startTauriOAuthRuntime")[0],
    ).not.toContain("initDeepLinks()");
  });
});
