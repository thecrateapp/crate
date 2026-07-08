import { render, screen, waitFor } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import {
  LISTEN_I18N_SOURCE_VERSION,
  writeCachedBundle,
} from "@/i18n/remote-bundles";
import {
  extractTranslationMarker,
  stripTranslationMarker,
} from "@/i18n/translation-mode/markers";

function Probe() {
  const { t } = useTranslation();
  return <span>{t("player.play")}</span>;
}

describe("I18nProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "languages", {
      value: ["en-US"],
      configurable: true,
    });
  });

  it("renders with the initial locale", async () => {
    render(
      <I18nProvider initialLocale="es">
        <Probe />
      </I18nProvider>,
    );

    expect(await screen.findByText("Reproducir")).toBeInTheDocument();
  });

  it("uses the stored local preference when no initial locale is provided", async () => {
    localStorage.setItem("crate-listen-locale", "ca");

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(await screen.findByText("Reprodueix")).toBeInTheDocument();
  });

  it("overlays a cached remote bundle during initial render", async () => {
    writeCachedBundle("web", "es", LISTEN_I18N_SOURCE_VERSION, {
      "player.play": "Dale",
    });

    render(
      <I18nProvider initialLocale="es">
        <Probe />
      </I18nProvider>,
    );

    expect(await screen.findByText("Dale")).toBeInTheDocument();
  });

  it("requests translation once when every browser language is unsupported", async () => {
    Object.defineProperty(navigator, "languages", {
      value: ["pl-PL"],
      configurable: true,
    });
    const fetchMock = vi.fn(async (url: string) => ({
      ok: url.includes("/translation-requests"),
      status: url.includes("/translation-requests") ? 202 : 404,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(await screen.findByText("Play")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/i18n/listen/translation-requests"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("appends invisible translation markers in translation mode", async () => {
    vi.stubEnv("VITE_TRANSLATION_MODE", "1");

    render(
      <I18nProvider initialLocale="es">
        <Probe />
      </I18nProvider>,
    );

    const node = await screen.findByText((content) => {
      return stripTranslationMarker(content) === "Reproducir";
    });
    expect(extractTranslationMarker(node.textContent ?? "")).toEqual({
      key: "player.play",
      locale: "es",
    });
  });
});
