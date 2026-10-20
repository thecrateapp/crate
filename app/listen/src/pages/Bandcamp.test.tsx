import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
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
  beforeEach(() => vi.clearAllMocks());
  it("uses canonical page identity and metrics with real zero readings", () => {
    renderWithListenProviders(<Bandcamp />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-display",
    );
    expect(screen.getByText("Owned", { exact: true })).toHaveClass(
      "font-mono",
      "uppercase",
    );
    expect(screen.getAllByText("0")).toHaveLength(3);
  });
  it("offers retry rather than showing empty collections and fake zero totals after a failed read", () => {
    const retry = vi.fn();
    vi.mocked(useApi).mockReturnValueOnce({
      data: null,
      loading: false,
      error: "Offline",
      refetch: retry,
    } as ReturnType<typeof useApi>);
    renderWithListenProviders(<Bandcamp />, { locale: "en" });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryAllByText("0")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

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
