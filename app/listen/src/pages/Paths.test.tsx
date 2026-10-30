import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PlayerActionsContext } from "@/contexts/player-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import {
  createMockPlayerActions,
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

import { PathDetail } from "./PathDetail";
import { Paths } from "./Paths";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

const mockUseApi = vi.mocked(useApi);

const pathDetail = {
  id: 77,
  name: "Punk to Post-hardcore",
  origin: { type: "genre", value: "punk", label: "punk" },
  destination: {
    type: "genre",
    value: "post-hardcore",
    label: "post-hardcore",
  },
  waypoints: [],
  step_count: 2,
  created_at: "2030-01-01T00:00:00Z",
  tracks: [
    {
      step: 1,
      progress: 0,
      track_id: 1,
      title: "Track One",
      artist: "Artist One",
      distance: 0.1,
    },
    {
      step: 2,
      progress: 1,
      track_id: 2,
      title: "Track Two",
      artist: "Artist Two",
      distance: 0.2,
    },
  ],
};

describe("Music paths pages", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    mockUseApi.mockImplementation((url: string | null) => {
      if (url === "/api/paths/77") {
        return {
          data: pathDetail,
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: [],
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("localizes the path builder chrome", () => {
    renderWithListenProviders(<Paths />, {
      route: "/paths",
      path: "/paths",
      locale: "es",
    });

    expect(
      screen.getByRole("heading", { name: "Rutas musicales" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Traza una ruta por el espacio acústico"),
    ).toBeInTheDocument();
    expect(screen.getByText("Desde")).toBeInTheDocument();
    expect(screen.getByText("Hasta")).toBeInTheDocument();
    expect(screen.getByText("Longitud de ruta")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Calcular ruta" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByPlaceholderText("Busca género, artista o álbum..."),
    ).toHaveLength(2);
  });

  it("uses actual shared labels and slider geometry in the builder", () => {
    const { container } = renderWithListenProviders(<Paths />);
    expect(
      screen
        .getByRole("heading", { name: "Music Paths" })
        .closest('[data-testid="page-header"]'),
    ).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Path length" });
    expect(slider).toHaveAttribute("data-slot", "slider");
    expect(slider.closest('[data-slot="form-field"]')).toHaveAttribute(
      "data-layout",
      "stacked",
    );
    expect(
      container.querySelector('[data-testid="empty-state"]'),
    ).toBeInTheDocument();
  });

  it("replaces the linear detail strip with actual covers; keyboard browsing does not play", () => {
    const playAll = vi.fn();
    const { container } = renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { playAll },
    });
    expect(
      container.querySelector('[data-slot="path-cover-journey"]'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next step" })).toBeNull();
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Play step 1: Track One by Artist One",
      }),
      { key: "ArrowRight" },
    );
    expect(playAll).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Play step 2: Track Two by Artist Two",
      }),
    );
    expect(playAll).toHaveBeenCalledWith(expect.any(Array), 1, {
      type: "queue",
      name: pathDetail.name,
      href: "/paths/77",
    });
  });

  it("follows actual player track changes without passively scrolling the page", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    function Harness() {
      const [trackId, setTrackId] = useState(1);
      return (
        <PlayerActionsContext.Provider
          value={createMockPlayerActions({
            currentTrack: createMockTrack({
              id: `track-${trackId}`,
              libraryTrackId: trackId,
            }),
          })}
        >
          <button type="button" onClick={() => setTrackId(2)}>
            Next fixture track
          </button>
          <PathDetail />
        </PlayerActionsContext.Provider>
      );
    }
    renderWithListenProviders(<Harness />, {
      route: "/paths/77",
      path: "/paths/:id",
    });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next fixture track" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it("keeps failed reads separate from an empty saved collection", () => {
    const refetch = vi.fn();
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: "offline",
      status: 503,
      refetch,
    });
    renderWithListenProviders(<Paths />);
    expect(screen.queryByTestId("empty-state")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("preserves selected endpoint IDs and length in the actual create request", async () => {
    vi.mocked(api).mockImplementation(async (url, method) => {
      if (url === "/api/genres") return [];
      if (url.startsWith("/api/catalog/search"))
        return {
          artists: [
            {
              id: url.includes("origin") ? 7 : 8,
              name: url.includes("origin")
                ? "Origin artist"
                : "Destination artist",
            },
          ],
        };
      if (url === "/api/paths" && method === "POST") return pathDetail;
      throw new Error(url);
    });
    renderWithListenProviders(<Paths />, { route: "/paths", path: "/paths" });
    fireEvent.change(screen.getByRole("searchbox", { name: "From" }), {
      target: { value: "origin" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Origin artist" }),
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "To" }), {
      target: { value: "destination" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Destination artist" }),
    );
    fireEvent.change(screen.getByRole("slider", { name: "Path length" }), {
      target: { value: "35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compute Path" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/paths", "POST", {
        origin: { type: "artist", value: "7" },
        destination: { type: "artist", value: "8" },
        step_count: 35,
      }),
    );
  });

  it("shows a not-found state instead of loading forever for a missing path", () => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: "Not found",
      status: 404,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<PathDetail />, {
      route: "/paths/404",
      path: "/paths/:id",
      locale: "es",
    });

    expect(screen.getByText("Ruta no encontrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reintentar/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Rutas/ })).toHaveAttribute(
      "href",
      "/paths",
    );
  });

  it("offers a retry when the path fails to load", () => {
    const refetch = vi.fn();
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: "Server error",
      status: 500,
      refetch,
    });

    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      locale: "es",
    });

    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("localizes the path detail chrome", () => {
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      locale: "es",
    });

    expect(
      screen.queryByRole("link", { name: "Rutas" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("page-header")).getByText("2 canciones"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eliminar" }),
    ).toBeInTheDocument();
  });

  it("renders path steps as track rows without a debug distance, playing from the step", async () => {
    const playAll = vi.fn();
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { playAll },
    });

    const row = screen.getByRole("row", { name: "Track Two" });
    expect(row).toHaveClass("track-row");
    expect(screen.queryByText("0.200")).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      1,
      { type: "queue", name: "Punk to Post-hardcore", href: "/paths/77" },
    );

    fireEvent.contextMenu(row);
    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });
});
