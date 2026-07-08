import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    localStorage.clear();
  });

  it("localizes the settings page chrome", () => {
    renderWithListenProviders(<Settings />, { locale: "es" });

    expect(
      screen.getByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reproducción")).toBeInTheDocument();
    expect(screen.getByText("Temporizador")).toBeInTheDocument();
    expect(screen.getByText("Idioma de la app")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Español/i })).toBeInTheDocument();
    expect(screen.getByText("1 h")).toBeInTheDocument();
    expect(screen.getByText("Al terminar la pista")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("tu-handle")).toBeInTheDocument();
    expect(screen.getByText("Enlaces rápidos")).toBeInTheDocument();
  });

  it("changes and stores the selected Listen language", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(screen.getByText("App language")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Español/i }));

    expect(localStorage.getItem("crate-listen-locale")).toBe("es");
    expect(
      await screen.findByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
  });
});
