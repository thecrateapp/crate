import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ArtistStats } from "./ArtistStats";

const { useApiMock, chartProps } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  chartProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@crate/ui/lib/motion-gate", () => ({ useMotionAllowed: () => false }));
vi.mock("@crate/ui/lib/read-css-color", () => ({
  readCssColorToken: (_: unknown, token: string) =>
    ({
      "--accent-action-hi": "rgb(1, 200, 220)",
      "--text-primary": "rgb(240, 240, 240)",
      "--text-secondary": "rgb(170, 170, 170)",
      "--text-subtle": "rgb(120, 120, 120)",
      "--border-quiet": "rgb(40, 40, 40)",
      "--surface-app": "rgb(10, 10, 10)",
    })[token],
}));
vi.mock("@nivo/bar", () => ({
  ResponsiveBar: (props: Record<string, unknown>) => {
    chartProps.push(props);
    return <div data-testid="stats-bar" />;
  },
}));
vi.mock("@nivo/pie", () => ({
  ResponsivePie: (props: Record<string, unknown>) => {
    chartProps.push(props);
    return <div data-testid="stats-pie" />;
  },
}));
vi.mock("@nivo/radar", () => ({
  ResponsiveRadar: (props: Record<string, unknown>) => {
    chartProps.push(props);
    return <div data-testid="stats-radar" />;
  },
}));

beforeEach(() => {
  chartProps.length = 0;
  useApiMock.mockReset();
});
it("exposes a retryable error rather than treating failed stats as empty", async () => {
  const refetch = vi.fn();
  useApiMock.mockReturnValue({
    data: null,
    loading: false,
    error: "failed",
    refetch,
  });
  render(<ArtistStats artistEntityUid="artist-1" />);
  expect(useApiMock).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-1/stats",
  );
  expect(screen.queryByText("No stats available")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledOnce();
});
it("keeps the shared loading state until statistics arrive", () => {
  useApiMock.mockReturnValue({
    data: null,
    loading: true,
    error: null,
    refetch: vi.fn(),
  });
  render(<ArtistStats artistId={7} />);
  expect(
    screen.getByRole("status", { name: "Loading stats" }),
  ).toBeInTheDocument();
});
it("respects motion preferences and resolves chart colors from the shared tokens", () => {
  useApiMock.mockReturnValue({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      formats: [{ id: "FLAC", value: 4 }],
      albums_timeline: [
        {
          name: "Album",
          year: "2000",
          track_count: 4,
          popularity: 10,
          lastfm_listeners: 20,
        },
      ],
      audio_by_album: [
        {
          album: "Album",
          avg_bpm: 120,
          avg_energy: 0.5,
          avg_danceability: 0.4,
          avg_valence: 0.3,
          avg_acousticness: 0.2,
        },
      ],
      top_tracks_by_popularity: [
        { title: "Song", album: "Album", popularity: 1, lastfm_listeners: 10 },
      ],
      genres: [{ name: "rock", weight: 0.6 }],
    },
  });
  render(<ArtistStats artistId={7} />);
  expect(
    screen.getByRole("heading", { name: "Discography Timeline" }),
  ).toHaveClass("crate-mono-label", "text-accent-action-hi");
  expect(screen.getByTestId("stats-pie")).toBeInTheDocument();
  expect(screen.getByTestId("stats-radar")).toBeInTheDocument();
  expect(chartProps.length).toBeGreaterThanOrEqual(6);
  for (const props of chartProps) {
    expect(props.animate).toBe(false);
    expect(props.colors).toContain("rgb(1, 200, 220)");
    expect(props.theme).toMatchObject({
      axis: { ticks: { text: { fill: "rgb(120, 120, 120)" } } },
    });
  }
});

it.each([
  "Discography Timeline",
  "Formats",
  "Genre Profile",
  "Most Popular Tracks",
  "Audio Profile by Album",
])(
  "leaves %s unruled when it is the first available statistics group",
  (firstPanel) => {
    const order = [
      "Discography Timeline",
      "Formats",
      "Genre Profile",
      "Most Popular Tracks",
      "Audio Profile by Album",
    ];
    const first = order.indexOf(firstPanel);
    useApiMock.mockReturnValue({
      loading: false,
      error: null,
      refetch: vi.fn(),
      data: {
        albums_timeline:
          first === 0
            ? [
                {
                  name: "Album",
                  year: "2000",
                  track_count: 4,
                  popularity: null,
                  lastfm_listeners: null,
                },
              ]
            : [],
        formats: first <= 1 ? [{ id: "FLAC", value: 4 }] : [],
        genres: first <= 2 ? [{ name: "rock", weight: 0.6 }] : [],
        top_tracks_by_popularity:
          first <= 3
            ? [
                {
                  title: "Song",
                  album: "Album",
                  popularity: 1,
                  lastfm_listeners: 10,
                },
              ]
            : [],
        audio_by_album: [
          {
            album: "Album",
            avg_bpm: 120,
            avg_energy: 0.5,
            avg_danceability: 0.4,
            avg_valence: 0.3,
            avg_acousticness: 0.2,
          },
        ],
      },
    });
    render(<ArtistStats artistId={7} />);
    for (const name of order.slice(first)) {
      const panel = screen
        .getByRole("heading", { name })
        .closest('[data-slot="instrument-panel"]');
      const firstGroup =
        name === firstPanel ||
        (firstPanel === "Formats" && name === "Genre Profile");
      if (firstGroup) expect(panel).not.toHaveClass("border-t");
      else expect(panel).toHaveClass("border-t");
    }
  },
);

it("preserves full category identities when labels share a truncated prefix", () => {
  useApiMock.mockReturnValue({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      formats: [],
      albums_timeline: [
        {
          name: "The very same long album prefix One",
          year: "2000",
          track_count: 4,
          popularity: 10,
          lastfm_listeners: 20,
        },
        {
          name: "The very same long album prefix Two",
          year: "2001",
          track_count: 5,
          popularity: 11,
          lastfm_listeners: 21,
        },
      ],
      audio_by_album: [],
      top_tracks_by_popularity: [
        { title: "Song", album: "One", popularity: 1, lastfm_listeners: 10 },
        { title: "Song", album: "Two", popularity: 1, lastfm_listeners: 20 },
      ],
      genres: [],
    },
  });
  render(<ArtistStats artistId={7} />);
  for (const chart of chartProps) {
    const rows = chart.data as Array<Record<string, unknown>>;
    expect(new Set(rows.map((row) => row[String(chart.indexBy)])).size).toBe(
      rows.length,
    );
  }
});
