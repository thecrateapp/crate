import { fireEvent, screen, within } from "@testing-library/react";
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
      "crate-page-title",
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

  it("leads with purchase album cards and keeps Radar rows actionable", () => {
    const purchase = {
      id: 10,
      album_title: "Purchased Album",
      artist_name: "Purchase Artist",
      item_url: "https://example.bandcamp.com/album/purchased",
      owned: true,
      downloadable: true,
    };
    const radar = {
      id: 11,
      album_title: "Radar Album",
      artist_name: "Radar Artist",
      item_url: "https://example.bandcamp.com/album/radar",
      owned: false,
    };
    for (const data of [
      { connected: true, status: "connected" },
      { items: [purchase], total: 1 },
      { items: [], total: 0 },
      { items: [radar], total: 1 },
    ]) {
      vi.mocked(useApi).mockReturnValueOnce({
        data,
        loading: false,
        error: null,
        refetch: vi.fn(),
      } as ReturnType<typeof useApi>);
    }
    renderWithListenProviders(<Bandcamp />, { locale: "en" });
    const purchases = screen.getByRole("region", { name: "Owned purchases" });
    const suggestions = screen.getByRole("region", { name: "Bandcamp Radar" });
    expect(
      purchases.compareDocumentPosition(suggestions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(purchases.querySelector('[data-slot="entity-card"]')).not.toBeNull();
    expect(purchases.querySelector('[data-slot="entity-row"]')).toBeNull();
    expect(
      within(purchases).getByRole("button", { name: "More actions" }),
    ).toBeVisible();
    expect(
      suggestions.querySelector('[data-slot="entity-row"]'),
    ).not.toBeNull();
    expect(suggestions.querySelector('[data-slot="entity-card"]')).toBeNull();
    expect(
      within(suggestions).getByRole("button", {
        name: "Open on Bandcamp: Radar Album",
      }),
    ).toBeVisible();
    expect(
      within(suggestions).queryByRole("button", { name: /Import:/ }),
    ).toBeNull();
  });
});
