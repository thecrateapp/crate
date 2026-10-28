import fixture from "../../../../tests/admin-e2e/fixtures/translations-1an.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  complete,
  installCatalogSample,
  setSample,
  setWorkspace,
} from "../../../../tools/design-system-preview/admin-translations-fixtures";
describe("Translations specimen effective dev-origin isolation", () => {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    vi.unstubAllEnvs();
    setSample("ready");
    setWorkspace(true);
  });
  afterEach(() => {
    complete();
    restore?.();
    restore = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    [undefined, "http://127.0.0.1:5174"],
    ["http://localhost:5174/", "http://localhost:5174"],
    ["http://127.0.0.1:5999/listen/", "http://127.0.0.1:5999/listen"],
  ])(
    "simulates probe and workspace PATCH for configured origin %s without original fetch",
    async (configured, origin) => {
      if (configured !== undefined)
        vi.stubEnv("VITE_LISTEN_DEV_ORIGIN", configured);
      const original = vi.fn(
        async () => new Response("Real fetch must not run", { status: 503 }),
      );
      vi.stubGlobal("fetch", original);
      restore = installCatalogSample();
      const catalog = `${origin}/__crate_i18n/catalogs`;
      const probe = await window.fetch(catalog, { method: "GET" });
      expect(probe.status).toBe(200);
      expect(await probe.json()).toEqual({ locales: ["es", "fr"] });
      const write = window.fetch(catalog + "/es", {
        method: "PATCH",
        body: JSON.stringify({
          key: "player.play",
          value: "Dale",
          markReviewed: true,
        }),
      });
      expect(original).not.toHaveBeenCalled();
      complete();
      expect((await write).status).toBe(200);
      expect(original).not.toHaveBeenCalled();
      // Other resources retain the caller's original fetch; this is a document-local boundary.
      await window.fetch("/unrelated-local-resource");
      expect(original).toHaveBeenCalledExactlyOnceWith(
        "/unrelated-local-resource",
        undefined,
      );
    },
  );
});

it("keeps every specimen bundle count consistent with its detail rows", () => {
  const responses = fixture as Record<string, unknown>;
  for (const summary of fixture["/api/admin/i18n/listen/bundles"].bundles) {
    const detail = responses[
      `/api/admin/i18n/listen/bundles/${summary.id}`
    ] as { messageCount: number; messages: Record<string, string> };
    expect(summary.messageCount, summary.locale).toBe(
      Object.keys(detail.messages).length,
    );
    expect(detail.messageCount, summary.locale).toBe(
      Object.keys(detail.messages).length,
    );
  }
});
