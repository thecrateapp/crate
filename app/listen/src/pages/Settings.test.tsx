import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Settings } from "@/pages/Settings";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/components/settings/ServersSection", () => ({
  ServersSection: () => <section>Servers</section>,
}));

vi.mock("@/components/settings/ConnectDevicesSection", () => ({
  ConnectDevicesSection: () => <section>Connect devices</section>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async (url: string) => {
      if (url === "/api/bandcamp/me/status") {
        return {
          connected: false,
          status: "disconnected",
          bridge_enabled: false,
        };
      }
      return {};
    }),
  };
});

describe("Settings", () => {
  it("localizes the settings page chrome", () => {
    renderWithListenProviders(<Settings />, { locale: "es" });

    expect(
      screen.getByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reproducción")).toBeInTheDocument();
    expect(screen.getByText("Temporizador")).toBeInTheDocument();
    expect(screen.getByText("Enlaces rápidos")).toBeInTheDocument();
  });
});
