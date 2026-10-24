import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { ArtistTopTracks } from "./ArtistTopTracks";

vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({ isLiked: () => false, toggleTrackLike: vi.fn() }),
}));
const retryArtist = vi.fn();
const retryTracks = vi.fn();
let artistRead: {
  data: unknown;
  loading: boolean;
  error: string | null;
  status: number | null;
};
let tracksRead: typeof artistRead;
function renderPage(playerActions = {}) {
  return renderWithListenProviders(<ArtistTopTracks />, {
    route: "/artists/crossed/top-tracks",
    path: "/artists/:artistSlug/top-tracks",
    playerActions,
  });
}

beforeEach(() => {
  retryArtist.mockReset();
  retryTracks.mockReset();
  artistRead = {
    data: { id: 7, slug: "crossed", name: "Crossed" },
    loading: false,
    error: null,
    status: 200,
  };
  tracksRead = { data: [], loading: false, error: null, status: 200 };
  vi.mocked(useApi).mockImplementation((url: string | null) =>
    url?.includes("/top-tracks")
      ? { ...tracksRead, refetch: retryTracks }
      : { ...artistRead, refetch: retryArtist },
  );
});

describe("ArtistTopTracks read states and actions", () => {
  it("keeps artist failures retryable rather than rendering a nameless playable page", async () => {
    artistRead = {
      data: null,
      loading: false,
      error: "unavailable",
      status: 503,
    };
    renderPage();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(
      screen.queryByRole("button", { name: "Play" }),
    ).not.toBeInTheDocument();
    await userEvent.click(retry);
    expect(retryArtist).toHaveBeenCalledOnce();
  });
  it("distinguishes a missing artist from an unavailable read", () => {
    artistRead = { data: null, loading: false, error: "missing", status: 404 };
    renderPage();
    expect(screen.getByText("Artist not found")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });
  it("does not confirm an empty track collection after a failed read", async () => {
    tracksRead = {
      data: null,
      loading: false,
      error: "unavailable",
      status: 503,
    };
    renderPage();
    expect(
      screen.getByRole("heading", { name: "Crossed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryTracks).toHaveBeenCalledOnce();
  });
  it("disables playback for confirmed empty results and keeps a shared header with Back navigation", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Crossed" }).closest("header"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/artists/crossed",
    );
    expect(
      screen.getByText("No top tracks available for this artist yet"),
    ).toBeInTheDocument();
  });
  it("renders actual track rows with their queue and keeps playback after a cached refresh failure", async () => {
    tracksRead = {
      data: [
        {
          id: "track-a",
          track_entity_uid: "track-a",
          title: "First Track",
          artist: "Crossed",
          artist_slug: "crossed",
          album: "First",
          duration: 180,
          track: 1,
          format: "flac",
          sample_rate: 96000,
          bit_depth: 24,
        },
      ],
      loading: false,
      error: "refresh failed",
      status: 503,
    };
    const playAll = vi.fn();
    renderPage({ playAll });
    expect(screen.getByText("First Track")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Top Tracks" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(playAll).toHaveBeenCalledWith(
      [expect.objectContaining({ title: "First Track", duration: 180 })],
      0,
      expect.objectContaining({ name: "Crossed Top Tracks" }),
    );
  });
});
