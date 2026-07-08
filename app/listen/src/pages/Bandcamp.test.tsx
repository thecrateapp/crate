import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Bandcamp } from "@/pages/Bandcamp";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn((url: string) => {
    if (url === "/api/bandcamp/me/status") {
      return {
        data: { connected: false, status: "disconnected" },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return {
      data: { items: [], total: 0 },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  }),
}));

describe("Bandcamp", () => {
  it("localizes the Bandcamp page chrome", () => {
    renderWithListenProviders(<Bandcamp />, { locale: "es" });

    expect(
      screen.getByRole("heading", { name: "Apoya lo que conservas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Radar de Bandcamp")).toBeInTheDocument();
    expect(screen.getByText("Compras propias")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No conectado. Abre Ajustes para conectar Bandcamp primero.",
      ),
    ).toBeInTheDocument();
  });
});
