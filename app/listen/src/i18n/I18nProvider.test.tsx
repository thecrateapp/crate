import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";

function Probe() {
  const { t } = useTranslation();
  return <span>{t("player.play")}</span>;
}

describe("I18nProvider", () => {
  it("renders with the initial locale", async () => {
    render(
      <I18nProvider initialLocale="es">
        <Probe />
      </I18nProvider>,
    );

    expect(await screen.findByText("Reproducir")).toBeInTheDocument();
  });
});
