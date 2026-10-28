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

  it("plays a saved path from the list without attributing it to a playlist", async () => {
    const playAll = vi.fn();
    mockUseApi.mockReturnValue({
      data: [{ ...pathDetail, track_count: pathDetail.tracks.length }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(api).mockResolvedValue(pathDetail);
    renderWithListenProviders(<Paths />, {
      route: "/paths",
      path: "/paths",
      playerActions: { playAll },
    });

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => expect(playAll).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/api/paths/77");
    expect(playAll).toHaveBeenCalledWith(expect.any(Array), 0, {
      type: "path",
      id: 77,
      name: pathDetail.name,
      href: "/paths/77",
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
      type: "path",
      id: 77,
      name: pathDetail.name,
      href: "/paths/77",
    });
  });

  it("retains the finite path source when the saved path contains a single track", () => {
    const play = vi.fn();
    const playAll = vi.fn();
    mockUseApi.mockReturnValue({
      data: {
        ...pathDetail,
        step_count: 20,
        generated_step_count: 1,
        is_partial: true,
        warnings: [{ code: "insufficient_tracks", expected: 20, actual: 1 }],
        tracks: [pathDetail.tracks[0]!],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { play, playAll },
    });

    fireEvent.click(screen.getByRole("row", { name: "Track One" }));

    expect(play).not.toHaveBeenCalled();
    expect(playAll).toHaveBeenCalledWith(
      [expect.objectContaining({ libraryTrackId: 1, title: "Track One" })],
      0,
      {
        type: "path",
        id: 77,
        name: pathDetail.name,
        href: "/paths/77",
      },
    );
    expect(api).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an album",
      playing: true,
      source: { type: "album" as const, id: 7, name: "Album" },
    },
    {
      label: "an album",
      playing: false,
      source: { type: "album" as const, id: 7, name: "Album" },
    },
    {
      label: "another path",
      playing: true,
      source: {
        type: "path" as const,
        id: 88,
        name: "Other journey",
        href: "/paths/88",
      },
    },
    {
      label: "another path",
      playing: false,
      source: {
        type: "path" as const,
        id: 88,
        name: "Other journey",
        href: "/paths/88",
      },
    },
  ])(
    "starts this path when its matching track belongs to $label (playing=$playing)",
    ({ source, playing }) => {
      const playAll = vi.fn();
      const pause = vi.fn();
      const resume = vi.fn();
      renderWithListenProviders(<PathDetail />, {
        route: "/paths/77",
        path: "/paths/:id",
        playerActions: {
          currentTrack: createMockTrack({
            id: "1",
            libraryTrackId: 1,
            title: "Track One",
            artist: "Artist One",
          }),
          playSource: source,
          playAll,
          pause,
          resume,
        },
        playerState: { isPlaying: playing },
      });

      fireEvent.click(screen.getByRole("row", { name: "Track One" }));

      expect(pause).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(playAll).toHaveBeenCalledWith(
        [
          expect.objectContaining({ libraryTrackId: 1 }),
          expect.objectContaining({ libraryTrackId: 2 }),
        ],
        0,
        { type: "path", id: 77, name: pathDetail.name, href: "/paths/77" },
      );
    },
  );

  it.each([true, false])(
    "toggles the matching active track only inside the same path (playing=%s)",
    (playing) => {
      const playAll = vi.fn();
      const pause = vi.fn();
      const resume = vi.fn();
      renderWithListenProviders(<PathDetail />, {
        route: "/paths/77",
        path: "/paths/:id",
        playerActions: {
          currentTrack: createMockTrack({
            id: "1",
            libraryTrackId: 1,
            title: "Track One",
            artist: "Artist One",
          }),
          playSource: {
            type: "path",
            id: 77,
            name: pathDetail.name,
            href: "/paths/77",
          },
          playAll,
          pause,
          resume,
        },
        playerState: { isPlaying: playing },
      });

      fireEvent.click(screen.getByRole("row", { name: "Track One" }));

      expect(playAll).not.toHaveBeenCalled();
      expect(playing ? pause : resume).toHaveBeenCalledOnce();
      expect(playing ? resume : pause).not.toHaveBeenCalled();
    },
  );

  it("skips unavailable saved tracks for header playback and remaps clicked rows", () => {
    const playAll = vi.fn();
    const sparse = {
      ...pathDetail,
      tracks: [
        { ...pathDetail.tracks[0]!, playable: false },
        { ...pathDetail.tracks[1]!, playable: true },
        {
          ...pathDetail.tracks[1]!,
          track_id: 3,
          step: 3,
          title: "Track Three",
          playable: false,
        },
        {
          ...pathDetail.tracks[1]!,
          track_id: 4,
          step: 4,
          title: "Track Four",
          playable: true,
        },
      ],
    };
    const before = structuredClone(sparse);
    mockUseApi.mockReturnValue({
      data: sparse,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { playAll },
    });

    const unavailable = screen.getByRole("row", { name: "Track One" });
    expect(unavailable).toHaveAttribute("data-disabled", "true");
    expect(unavailable).toHaveAttribute("tabindex", "-1");
    expect(within(unavailable).queryByText("Soon")).not.toBeInTheDocument();
    expect(within(unavailable).getByText(/unavailable/i)).toBeInTheDocument();
    fireEvent.click(unavailable);
    expect(playAll).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByTestId("page-header")).getByRole("button", {
        name: "Play",
      }),
    );
    expect(playAll).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ libraryTrackId: 2 }),
        expect.objectContaining({ libraryTrackId: 4 }),
      ],
      0,
      expect.objectContaining({ type: "path", id: 77 }),
    );
    fireEvent.click(screen.getByRole("row", { name: "Track Four" }));
    expect(playAll).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ libraryTrackId: 2 }),
        expect.objectContaining({ libraryTrackId: 4 }),
      ],
      1,
      expect.objectContaining({ type: "path", id: 77 }),
    );
    expect(sparse).toEqual(before);
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps unavailable cover steps inspectable but never starts playback from them", () => {
    const playAll = vi.fn();
    mockUseApi.mockReturnValue({
      data: {
        ...pathDetail,
        tracks: pathDetail.tracks.map((track) => ({
          ...track,
          playable: false,
        })),
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { playAll },
    });

    expect(
      within(screen.getByTestId("page-header")).getByRole("button", {
        name: "Play",
      }),
    ).toBeDisabled();
    const step = screen.getByRole("button", {
      name: "Play step 2: Track Two by Artist Two",
    });
    expect(step).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(step);
    expect(playAll).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("presents partial generation and later availability separately without regenerating", () => {
    mockUseApi.mockReturnValue({
      data: {
        ...pathDetail,
        step_count: 5,
        generated_step_count: 2,
        is_partial: true,
        warnings: [{ code: "insufficient_tracks", expected: 5, actual: 2 }],
        tracks: pathDetail.tracks.map((track, index) => ({
          ...track,
          playable: index !== 0,
        })),
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
    });

    const statuses = screen.getAllByRole("status");
    expect(
      statuses.some((status) => /2.*5/.test(status.textContent || "")),
    ).toBe(true);
    expect(
      statuses.some((status) => /unavailable/i.test(status.textContent || "")),
    ).toBe(true);
    expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Track Two" })).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
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
      {
        type: "path",
        id: 77,
        name: "Punk to Post-hardcore",
        href: "/paths/77",
      },
    );

    fireEvent.contextMenu(row);
    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });
});
