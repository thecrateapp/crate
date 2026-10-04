import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

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

    expect(screen.getByText("Rutas")).toBeInTheDocument();
    expect(screen.getByText("2 canciones")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eliminar" }),
    ).toBeInTheDocument();
  });

  it("renders path steps as track rows with distance meta, playing from the step", async () => {
    const playAll = vi.fn();
    renderWithListenProviders(<PathDetail />, {
      route: "/paths/77",
      path: "/paths/:id",
      playerActions: { playAll },
    });

    const row = screen.getByRole("row", { name: "Track Two" });
    expect(row).toHaveClass("track-row");
    expect(screen.getByText("0.200")).toBeInTheDocument();

    fireEvent.click(row);
    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      1,
      { type: "playlist", name: "Punk to Post-hardcore", id: 77 },
    );

    fireEvent.contextMenu(row);
    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });
});
