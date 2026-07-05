import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import {
  LISTEN_I18N_SOURCE_VERSION,
  writeCachedBundle,
} from "@/i18n/remote-bundles";

function Probe() {
  const { t } = useTranslation();
  return <span>{t("player.play")}</span>;
}

describe("I18nProvider", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
