import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: vi.fn() };
});
vi.mock("@/lib/network-search-stream", () => ({
  openNetworkSearchStream: vi.fn(),
}));
vi.mock("@/hooks/use-network-search-available", () => ({
  useNetworkSearchAvailable: vi.fn(() => true),
}));
vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: vi.fn(() => false),
    toggleTrackLike: vi.fn(async () => false),
  }),
}));
vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(async () => false),
  }),
}));

import { useNetworkSearchAvailable } from "@/hooks/use-network-search-available";
import { api } from "@/lib/api";
import {
  openNetworkSearchStream,
  type NetworkSearchCoverage,
  type NetworkSearchHandlers,
} from "@/lib/network-search-stream";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { SearchResults } from "./SearchResults";

const EMPTY = { artists: [], albums: [], tracks: [] };

function coverage(
  patch: Partial<NetworkSearchCoverage> = {},
): NetworkSearchCoverage {
  return {
    state: "searching",
    reason: "few_local_results",
    window_ms: 2000,
    peers_total: 4,
    peers_answered: 0,
    peers_failed: 0,
    peers_timed_out: 0,
    peers_pending: 4,
    peers: [],
    ...patch,
  };
}

const REMOTE = {
  ...EMPTY,
  tracks: [
    {
      title: "Isolation",
      artist: "Joy Division",
      album: "Closer",
      origin: "remote" as const,
      node_uid: "node-b",
      node_name: "Les Pedants",
      remote_entity_uid: "track-b",
      availability: { catalog: true, stream: true, import: false },
    },
  ],
  albums: [
    {
      name: "Closer",
      artist: "Joy Division",
      year: "1980",
      origin: "remote" as const,
      node_uid: "node-b",
      node_name: "Les Pedants",
      remote_entity_uid: "album-b",
    },
  ],
};

let streams: { query: string; handlers: NetworkSearchHandlers }[] = [];

function renderSearch(query: string) {
  return renderWithListenProviders(<SearchResults />, {
    path: "/search",
    route: "/search?q=" + encodeURIComponent(query),
  });
}

beforeEach(() => {
  streams = [];
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue(EMPTY);
  vi.mocked(useNetworkSearchAvailable).mockReturnValue(true);
  vi.mocked(openNetworkSearchStream).mockReset();
  vi.mocked(openNetworkSearchStream).mockImplementation((query, handlers) => {
    streams.push({ query, handlers });
    return () => undefined;
  });
});

function searchCalls() {
  return vi
    .mocked(api)
    .mock.calls.filter(([path]) =>
      String(path).startsWith("/api/catalog/search"),
    );
}

describe("SearchResults with network search", () => {
  it("keeps the canonical search when the server does not offer it", async () => {
    vi.mocked(useNetworkSearchAvailable).mockReturnValue(false);

    renderSearch("joy division");

    await screen.findByText("No music found");
    expect(openNetworkSearchStream).not.toHaveBeenCalled();
    expect(searchCalls()).toHaveLength(1);
    expect(String(searchCalls()[0]![0])).toContain("q=joy%20division");
  });

  it("keeps short queries local", async () => {
    renderSearch("jo");

    await screen.findByText("No music found");
    expect(openNetworkSearchStream).not.toHaveBeenCalled();
  });

  it("shows local results at once and network results with their coverage", async () => {
    renderSearch("joy division");
    await waitFor(() => expect(streams).toHaveLength(1));
    const { handlers } = streams[0]!;
    expect(searchCalls()).toHaveLength(0);

    act(() => {
      handlers.onLocal({
        ...EMPTY,
        tracks: [
          {
            title: "Disorder",
            artist: "Joy Division",
            album: "Unknown Pleasures",
            global_track_uid: "local",
          },
        ],
      });
      handlers.onCoverage(coverage());
    });
    expect(await screen.findByText("Disorder")).toBeInTheDocument();
    expect(screen.getByText("Searching 4 peers...")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "More results from the network" }),
    ).toBeInTheDocument();

    act(() => {
      handlers.onRemote(
        REMOTE,
        coverage({ peers_answered: 1, peers_pending: 3 }),
      );
    });
    expect(await screen.findByText("Isolation")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 peers")).toBeInTheDocument();
    expect(
      screen.getByText("1980 · Joy Division · via Les Pedants"),
    ).toBeInTheDocument();

    act(() => {
      handlers.onDone(
        coverage({
          state: "partial",
          peers_answered: 3,
          peers_timed_out: 1,
          peers_pending: 0,
        }),
      );
    });
    expect(await screen.findByText("3 of 4 peers")).toBeInTheDocument();
    expect(screen.getByText("1 peer did not answer.")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Search the network again" }),
    );
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(streams[1]!.query).toBe("joy division");
  });

  it("never says the music is not in the network", async () => {
    renderSearch("rare bootleg");
    await waitFor(() => expect(streams).toHaveLength(1));
    const { handlers } = streams[0]!;

    act(() => {
      handlers.onLocal(EMPTY);
      handlers.onCoverage(coverage());
    });
    expect(await screen.findByText("Searching 4 peers...")).toBeInTheDocument();
    expect(screen.queryByText("No music found")).not.toBeInTheDocument();

    act(() => {
      handlers.onDone(
        coverage({
          state: "partial",
          peers_answered: 3,
          peers_failed: 1,
          peers_pending: 0,
        }),
      );
    });

    expect(await screen.findByText("No music found")).toBeInTheDocument();
    expect(
      screen.getByText("No results in 3 of 4 peers. 1 peer did not answer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not in the network/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search the network again" }),
    ).toBeInTheDocument();
  });

  it("does not count results from peers that never answered", async () => {
    renderSearch("rare bootleg");
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => {
      streams[0]!.handlers.onLocal(EMPTY);
      streams[0]!.handlers.onDone(
        coverage({
          state: "partial",
          peers_total: 1,
          peers_failed: 1,
          peers_pending: 0,
        }),
      );
    });

    expect(
      await screen.findByText("1 peer did not answer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No results in 0/)).not.toBeInTheDocument();
  });

  it("does not flash an empty state before the server decides", async () => {
    renderSearch("rare bootleg");
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.handlers.onLocal(EMPTY));

    expect(
      await screen.findByRole("heading", {
        name: 'Results for "rare bootleg"',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No music found")).not.toBeInTheDocument();
  });

  it("says nothing about the network when it was not asked", async () => {
    renderSearch("joy division");
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => {
      streams[0]!.handlers.onLocal(EMPTY);
      streams[0]!.handlers.onDone(
        coverage({
          state: "skipped",
          reason: "no_peers",
          peers_total: 0,
          peers_pending: 0,
        }),
      );
    });

    expect(
      await screen.findByText("Try another artist, album, or track."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("More results from the network"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the canonical search when the stream fails before local results", async () => {
    vi.mocked(api).mockResolvedValue({
      ...EMPTY,
      tracks: [
        {
          title: "Disorder",
          artist: "Joy Division",
          album: "Unknown Pleasures",
          global_track_uid: "local",
        },
      ],
    });
    renderSearch("joy division");
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.handlers.onError(true));

    expect(await screen.findByText("Disorder")).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(1);
    expect(
      screen.getByText("The network search stopped before it finished."),
    ).toBeInTheDocument();
  });
});
