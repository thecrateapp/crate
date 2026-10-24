import { albumCoverApiUrl } from "@/lib/library-routes";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { ArtistStats } from "./ArtistStats";
import type { ArtistStatsData } from "./artist-stats-model";
const {
  statsApiMock,
  analysisApiMock,
  capabilitiesApiMock,
  scatterProps,
  barProps,
} = vi.hoisted(() => ({
  statsApiMock: vi.fn(),
  analysisApiMock: vi.fn(),
  capabilitiesApiMock: vi.fn(),
  scatterProps: [] as Array<Record<string, unknown>>,
  barProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string | null) =>
    url?.endsWith("/analysis-data")
      ? analysisApiMock(url)
      : url === "/api/capabilities"
        ? capabilitiesApiMock(url)
        : statsApiMock(url),
}));
vi.mock("@nivo/scatterplot", () => ({
  ResponsiveScatterPlot: (props: Record<string, unknown>) => {
    scatterProps.push(props);
    const series = props.data as {
      data: { id: string; album: string; x: number; y: number }[];
    }[];
    const mark = props.nodeComponent as (args: {
      node: {
        x: number;
        y: number;
        data: (typeof series)[number]["data"][number];
      };
    }) => ReactNode;
    return (
      <svg
        data-testid="sonic-plot"
        role={props.role as string}
        aria-label={props.ariaLabel as string}
      >
        {series.flatMap((group) =>
          group.data.map((point) => (
            <g key={point.id}>
              {mark({ node: { x: point.x, y: point.y, data: point } })}
            </g>
          )),
        )}
        {(props.layers as unknown[])
          .filter(
            (layer): layer is (args: unknown) => ReactNode =>
              typeof layer === "function",
          )
          .map((layer, index) => (
            <g key={index}>
              {layer({
                nodes: series.flatMap((group) =>
                  group.data.map((point) => ({
                    x: point.x,
                    y: point.y,
                    data: point,
                  })),
                ),
                innerWidth: 300,
                innerHeight: 220,
              })}
            </g>
          ))}
      </svg>
    );
  },
}));
vi.mock("@nivo/bar", () => ({
  Bar: (props: Record<string, unknown>) => {
    barProps.push(props);
    return <div data-testid="ranking-plot" />;
  },
}));
vi.mock("@crate/ui/lib/motion-gate", () => ({ useMotionAllowed: () => false }));
const payload: ArtistStatsData = {
  formats: [
    { id: "FLAC", value: 3 },
    { id: "MP3", value: 1 },
    { id: "unknown", value: 10 },
  ],
  albums_timeline: [
    {
      name: "Same",
      year: "2000",
      track_count: 4,
      total_duration: 3600,
      popularity: 99,
      lastfm_listeners: null,
    },
    {
      name: "Same",
      year: "2000",
      track_count: 5,
      total_duration: 0,
      popularity: 0,
      lastfm_listeners: 0,
    },
    { name: "Unknown", year: "", track_count: 1 },
  ],
  audio_by_album: [
    {
      album: "Same",
      avg_bpm: 120,
      avg_loudness: 0,
      avg_energy: 0,
      avg_danceability: null,
      avg_valence: 0.3,
      avg_acousticness: 0.2,
    },
    {
      album: "Same",
      avg_bpm: null,
      avg_energy: 0.8,
      avg_danceability: 0,
      avg_valence: null,
      avg_acousticness: null,
    },
  ],
  top_tracks_by_popularity: [
    { title: "Song", album: "Same", popularity: 0, lastfm_listeners: 1234 },
  ],
  genres: [{ name: "rock", weight: 0.6 }],
};
function show(data = payload) {
  statsApiMock.mockReturnValue({ data, loading: false, error: null });
  return render(
    <MemoryRouter>
      <ArtistStats artistId={7} />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  statsApiMock.mockReset();
  analysisApiMock
    .mockReset()
    .mockReturnValue({ data: {}, loading: false, error: null });
  capabilitiesApiMock.mockReset().mockReturnValue({
    data: { smart_mix: { available: true } },
    loading: false,
    error: null,
  });
  scatterProps.length = 0;
  barProps.length = 0;
});
it("exposes retryable errors and shared loading/empty states", async () => {
  const refetch = vi.fn();
  statsApiMock.mockReturnValue({
    data: null,
    loading: false,
    error: "failed",
    refetch,
  });
  const view = render(<ArtistStats artistEntityUid="artist-1" />);
  expect(statsApiMock).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-1/stats",
  );
  expect(analysisApiMock).toHaveBeenCalledWith(
    "/api/artists/by-entity/artist-1/analysis-data",
  );
  expect(capabilitiesApiMock).toHaveBeenCalledWith("/api/capabilities");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledOnce();
  statsApiMock.mockReturnValue({ loading: true });
  view.rerender(<ArtistStats artistId={7} />);
  expect(
    screen.getByRole("status", { name: "Loading stats" }),
  ).toBeInTheDocument();
  statsApiMock.mockReturnValue({
    data: {
      formats: [],
      albums_timeline: [],
      audio_by_album: [],
      genres: [],
      top_tracks_by_popularity: [],
    },
  });
  view.rerender(<ArtistStats artistId={7} />);
  expect(
    screen.getByRole("status", { name: "No statistics available" }),
  ).toBeInTheDocument();
});

it("keeps selected release and audio observations when lazy analysis arrives", async () => {
  analysisApiMock.mockReturnValue({ data: null, loading: true, error: null });
  const view = show();
  await userEvent.click(
    screen.getAllByRole("button", { name: /Inspect Same, 2000/ })[1]!,
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Inspect Same in incomplete audio observations",
    }),
  );
  expect(
    within(screen.getByRole("group", { name: "Release reading" })).getByText(
      "5",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "Audio reading" })).getAllByText(
      "Unavailable",
    ).length,
  ).toBeGreaterThan(0);
  analysisApiMock.mockReturnValue({
    data: {
      song: {
        track_id: 1,
        tempo: 140,
        smart_mix: { is_current_full_profile: true },
        bliss: { available: true },
      },
    },
    loading: false,
    error: null,
  });
  view.rerender(
    <MemoryRouter>
      <ArtistStats artistId={7} />
    </MemoryRouter>,
  );
  expect(
    within(screen.getByRole("group", { name: "Mean BPM" })).getByText("140"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "Release reading" })).getByText(
      "5",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "Audio reading" })).getAllByText(
      "Unavailable",
    ).length,
  ).toBeGreaterThan(0);
});

it("counts local timeline albums independently of the broader catalogue prop", () => {
  statsApiMock.mockReturnValue({ data: payload, loading: false, error: null });
  render(
    <MemoryRouter>
      <ArtistStats
        artistId={7}
        catalogueAlbums={[
          {
            id: 99,
            name: "Future catalogue release",
            year: "2030",
            tracks: 12,
            formats: [],
            size_mb: 0,
            has_cover: false,
          },
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    within(screen.getByRole("group", { name: "Local albums" })).getByText("3"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "Tracks" })).getByText("10"),
  ).toBeInTheDocument();
});
it("preserves distinct coincident releases and undated observations", async () => {
  show();
  expect(screen.getByText("Undated releases · 1")).toBeInTheDocument();
  const nodes = screen.getAllByRole("button", { name: /Inspect Same, 2000/ });
  expect(nodes).toHaveLength(2);
  await userEvent.click(nodes[1]!);
  const readout = screen.getByRole("group", { name: "Release reading" });
  expect(within(readout).getByText("5")).toBeInTheDocument();
  expect(within(readout).getByText("0h 0m")).toBeInTheDocument();
});
it("keeps missing audio selectable without plotting fabricated zeros", async () => {
  show();
  const data = scatterProps[0]?.data as { data: unknown[] }[];
  expect(data[0]?.data).toHaveLength(1);
  expect(scatterProps[0]?.animate).toBe(false);
  expect(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect(
    within(screen.getByRole("group", { name: "Audio reading" })).getByText(
      "0 dB",
    ),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Inspect Same in incomplete audio observations",
    }),
  );
  const readout = screen.getByRole("group", { name: "Audio reading" });
  expect(within(readout).getAllByText("Unavailable").length).toBeGreaterThan(0);
  expect(screen.getByRole("meter", { name: "Danceability" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});
it("keeps track popularity and album listeners in separate units", async () => {
  show();
  expect(screen.queryByRole("combobox", { name: /track.*unit/i })).toBeNull();
  await userEvent.click(
    screen.getByRole("combobox", { name: "Album ranking unit" }),
  );
  await userEvent.click(
    screen.getByRole("option", { name: "Last.fm listeners" }),
  );
  const albums = screen.getByRole("region", { name: "Album rankings" });
  expect(within(albums).getAllByText("Same")).toHaveLength(1);
  expect(within(albums).queryByText("99")).toBeNull();
  expect(
    screen.getByText("Known-format tracks only · 4 tracks"),
  ).toBeInTheDocument();
  expect(screen.getByText("75%")).toBeInTheDocument();
  expect(within(albums).getByText("0 / 0 max")).toBeInTheDocument();
  expect(
    within(albums).getByText("Last.fm listeners · max 0"),
  ).toBeInTheDocument();
});

it("selects by keyboard and nearest plot coordinates without overlapping per-point targets", () => {
  show({
    ...payload,
    audio_by_album: [
      payload.audio_by_album[0]!,
      { album: "Other", avg_bpm: 125, avg_energy: 0 },
    ],
  });
  const release = screen.getByRole("button", {
    name: "Inspect Same, 2000, 5 tracks",
  });
  fireEvent.keyDown(release, { key: "Enter" });
  expect(release).toHaveAttribute("aria-pressed", "true");
  expect(release.querySelector('circle[fill="transparent"]')).toBeNull();
  const overlay = screen.getByTestId("sonic-interaction");
  fireEvent.click(overlay, { clientX: 120, clientY: 0 });
  expect(
    screen.getByRole("button", { name: "Inspect audio Same" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(overlay, { clientX: 125, clientY: 0 });
  expect(
    screen.getByRole("button", { name: "Inspect audio Other" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(screen.getByRole("group", { name: "Audio reading" })).getByText(
      "Other",
    ),
  ).toBeInTheDocument();
});
it("uses consolidated popularity including a measured zero and retains legacy fallback", () => {
  show({
    ...payload,
    top_tracks_by_popularity: [
      {
        title: "Consolidated",
        album: "A",
        popularity_score: 0,
        popularity: 99,
        lastfm_listeners: 123,
      },
      {
        title: "Normalized",
        album: "C",
        popularity_score: 0.97,
        popularity: 20,
        lastfm_listeners: 789,
      },
      {
        title: "Fallback",
        album: "B",
        popularity_score: null,
        popularity: 52,
        lastfm_listeners: 456,
      },
    ],
  });
  const tracks = screen.getByRole("region", { name: "Track rankings" });
  expect(within(tracks).getByText("0/100")).toBeInTheDocument();
  expect(within(tracks).getByText("52/100")).toBeInTheDocument();
  expect(within(tracks).getByText("97/100")).toBeInTheDocument();
  expect(within(tracks).queryByText("99/100")).toBeNull();
});
it("uses a full scale reference and wrapping metadata in both popularity rankings", () => {
  show();
  const tracks = screen.getByRole("region", { name: "Track rankings" });
  const albums = screen.getByRole("region", { name: "Album rankings" });
  expect(within(albums).getByText("99/100")).toBeInTheDocument();
  for (const section of [tracks, albums]) {
    expect(
      section.querySelector('[data-slot="hairline-row"] .wrap-anywhere'),
    ).toBeTruthy();
    expect(
      section.querySelector('[data-slot="hairline-row"] .truncate'),
    ).toBeNull();
  }
  const layer = (
    barProps[0]?.layers as Array<(args: unknown) => ReactNode>
  )[0]!;
  const plot = render(
    <svg>
      {layer({
        bars: [{ key: "sample", x: 0, y: 0, width: 40, height: 10 }],
        innerWidth: 102,
      })}
    </svg>,
  );
  expect(
    plot.container.querySelector('[data-slot="ranking-reference"]'),
  ).toHaveAttribute("x2", "102");
  expect(
    plot.container.querySelector('[data-slot="ranking-value"]'),
  ).toHaveAttribute("x2", "40");
  expect(plot.container.querySelector("rect")).toBeNull();
});
it("omits the redundant genre profile", () => {
  show();
  expect(screen.queryByRole("region", { name: "Genre profile" })).toBeNull();
  const view = screen.getByRole("region", { name: "Track rankings" });
  expect(view).toBeInTheDocument();
});
it("treats a genre-only payload as having no stats", () => {
  show({
    formats: [],
    albums_timeline: [],
    audio_by_album: [],
    top_tracks_by_popularity: [],
    genres: payload.genres,
  });
  expect(
    screen.getByRole("status", { name: "No statistics available" }),
  ).toBeInTheDocument();
});
it("uses real year positions even when the payload is unsorted", () => {
  show({
    ...payload,
    albums_timeline: [
      { name: "Middle", year: "2002", track_count: 1 },
      { name: "Last", year: "2010", track_count: 1 },
      { name: "First", year: "2000", track_count: 1 },
    ],
  });
  const timeline = screen.getByRole("group", {
    name: "Chronological releases",
  });
  expect(
    screen.getByRole("button", { name: "Inspect Last, 2010, 1 tracks" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(screen.getByRole("group", { name: "Release reading" })).getByText(
      "Last",
    ),
  ).toBeInTheDocument();
  expect(within(timeline).getByText("2000")).toBeInTheDocument();
  expect(within(timeline).getByText("2010")).toBeInTheDocument();
  const x = (name: string) =>
    Number(
      screen
        .getByRole("button", { name })
        .querySelector("[data-selected], .instrument-chart-point")
        ?.getAttribute("transform")
        ?.match(/translate\(([^,]+)/)?.[1],
    );
  expect(
    (x("Inspect Middle, 2002, 1 tracks") - x("Inspect First, 2000, 1 tracks")) /
      (x("Inspect Last, 2010, 1 tracks") - x("Inspect First, 2000, 1 tracks")),
  ).toBeCloseTo(0.2);
});

it("starts both graphs on their newest dated observation and changes the reading on hover", () => {
  show({
    ...payload,
    albums_timeline: [
      { name: "Unknown", year: null, track_count: 1 },
      { name: "Newest", year: "2024-09-12", track_count: 2 },
      { name: "Older", year: "2023", track_count: 3 },
    ],
    audio_by_album: [
      { album: "Unknown", avg_bpm: 100, avg_energy: 0.1 },
      { album: "Newest", year: "2024-09", avg_bpm: 120, avg_energy: 0.5 },
      { album: "Older", year: "2023", avg_bpm: 90, avg_energy: 0.8 },
    ],
  });
  const release = screen.getByRole("group", { name: "Release reading" });
  const audio = screen.getByRole("group", { name: "Audio reading" });
  expect(within(release).getByText("Newest")).toBeInTheDocument();
  expect(within(audio).getByText("Newest")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Inspect Newest, 2024, 2 tracks" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "Inspect audio Newest" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.pointerMove(screen.getByTestId("sonic-interaction"), {
    clientX: 90,
    clientY: 0,
  });
  expect(within(audio).getByText("Older")).toBeInTheDocument();
});

it("uses unique catalogue dates to initialize legacy audio observations", () => {
  statsApiMock.mockReturnValue({
    data: {
      ...payload,
      audio_by_album: [
        { album: "Undated", avg_bpm: 100, avg_energy: 0.1 },
        { album: "Dated", avg_bpm: 120, avg_energy: 0.5 },
      ],
    },
    loading: false,
  });
  render(
    <MemoryRouter>
      <ArtistStats
        artistId={7}
        catalogueAlbums={[
          {
            id: 8,
            name: "Dated",
            year: "2022",
            tracks: 1,
            formats: [],
            size_mb: 1,
            has_cover: false,
          },
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    within(screen.getByRole("group", { name: "Audio reading" })).getByText(
      "Dated",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Inspect audio Dated" }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("exposes coincident sonic observations through separate touch and keyboard targets", async () => {
  show({
    ...payload,
    audio_by_album: [
      { album: "Coincident", year: "2023", avg_bpm: 120, avg_energy: 0.5 },
      { album: "Coincident", year: "2024", avg_bpm: 120, avg_energy: 0.5 },
    ],
  });
  expect(screen.getByTestId("sonic-plot")).toHaveAttribute("role", "group");
  expect(screen.getByTestId("sonic-plot")).toHaveAttribute(
    "aria-label",
    "Sonic chart nodes",
  );
  const rail = screen.getByRole("group", {
    name: "Overlapping audio observations",
  });
  const choices = within(rail).getAllByRole("button", {
    name: /Inspect Coincident/,
  });
  expect(choices).toHaveLength(2);
  choices[0]!.focus();
  await userEvent.keyboard("{Enter}");
  expect(choices[0]).toHaveAttribute("aria-pressed", "true");
  expect(choices[1]).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(choices[1]!);
  expect(choices[1]).toHaveAttribute("aria-pressed", "true");
  const plot = screen.getByTestId("sonic-interaction");
  fireEvent.click(plot, { clientX: 120, clientY: 0.5 });
  expect(choices[0]).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(plot, { clientX: 120, clientY: 0.5 });
  expect(choices[1]).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getAllByRole("button", { name: /Inspect audio Coincident/ }),
  ).toHaveLength(2);
});

it("retains unavailable observations when none can enter the sonic plot", () => {
  show({
    ...payload,
    albums_timeline: [],
    audio_by_album: [payload.audio_by_album[1]!],
  });
  expect(
    screen.getByRole("status", { name: "No plottable observations" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Inspect Same in incomplete audio observations",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "Danceability" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect(screen.getByRole("group", { name: "Valence" })).toHaveTextContent(
    "n/a",
  );
});
it("uses the compact undated node rail for keyboard inspection", async () => {
  show();
  const node = screen.getByRole("button", {
    name: "Inspect Unknown in undated releases",
  });
  node.focus();
  await userEvent.keyboard("{Enter}");
  expect(node).toHaveAttribute("aria-pressed", "true");
  const reading = screen.getByRole("group", { name: "Release reading" });
  expect(within(reading).getByText("Unknown")).toBeInTheDocument();
  expect(within(reading).getAllByText("Unavailable")).toHaveLength(2);
});
it.each(["Formats", "Track rankings", "Sonic map"])(
  "leaves %s unruled when it is the first group",
  (title) => {
    show({
      formats: title === "Formats" ? payload.formats : [],
      genres: [],
      top_tracks_by_popularity:
        title === "Track rankings" ? payload.top_tracks_by_popularity : [],
      audio_by_album: title === "Sonic map" ? payload.audio_by_album : [],
      albums_timeline: [],
    });
    expect(screen.getByRole("region", { name: title })).not.toHaveClass(
      "border-t",
    );
  },
);

it("shares the Nivo linear valueScale across rows in each ranking unit", async () => {
  show({
    ...payload,
    albums_timeline: payload.albums_timeline.map((row, index) => ({
      ...row,
      lastfm_listeners: index ? 500 : 1000,
    })),
  });
  expect(barProps.length).toBeGreaterThan(0);
  for (const props of barProps) {
    expect(props.valueScale).toEqual({ type: "linear", min: 0, max: 100 });
    expect(props).not.toHaveProperty("minValue");
    expect(props).not.toHaveProperty("maxValue");
  }
  barProps.length = 0;
  await userEvent.click(
    screen.getByRole("combobox", { name: "Album ranking unit" }),
  );
  await userEvent.click(
    screen.getByRole("option", { name: "Last.fm listeners" }),
  );
  const albumScales = barProps.filter((props) =>
    (props.data as { id: string }[])[0]?.id.startsWith("release-"),
  );
  expect(albumScales).toHaveLength(3);
  for (const props of albumScales)
    expect(props.valueScale).toEqual({ type: "linear", min: 0, max: 1000 });
});

it("keeps timeline geometry in actual container pixels after ResizeObserver updates", () => {
  let resize: ResizeObserverCallback | undefined;
  const observer = vi
    .spyOn(globalThis, "ResizeObserver")
    .mockImplementation(function (callback: ResizeObserverCallback) {
      resize = callback;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
  show({
    ...payload,
    albums_timeline: [
      { name: "First", year: "2000", track_count: 1 },
      { name: "Close", year: "2001", track_count: 1 },
      { name: "Last", year: "2020", track_count: 1 },
    ],
  });
  act(() =>
    resize?.(
      [{ contentRect: { width: 280 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
  const timeline = screen.getByRole("group", {
    name: "Chronological releases",
  });
  expect(timeline).toHaveAttribute("viewBox", "0 0 280 140");
  expect(timeline).toHaveAttribute("width", "280");
  expect(within(timeline).getByText("2000")).toHaveAttribute("font-size", "11");
  const overlay = screen.getByTestId("release-interaction");
  expect(overlay).toHaveAttribute("width", "280");
  fireEvent.click(overlay, { clientX: 28, clientY: 83 });
  expect(
    within(screen.getByRole("group", { name: "Release reading" })).getByText(
      "First",
    ),
  ).toBeInTheDocument();
  fireEvent.click(overlay, { clientX: 39.2, clientY: 83 });
  expect(
    within(screen.getByRole("group", { name: "Release reading" })).getByText(
      "Close",
    ),
  ).toBeInTheDocument();
  const first = screen.getByRole("button", {
    name: "Inspect First, 2000, 1 tracks",
  });
  expect(first.querySelector(".instrument-chart-point")).toHaveAttribute(
    "data-muted",
    "true",
  );
  observer.mockRestore();
});

it("supplies catalogue covers and years to observation inspectors", () => {
  statsApiMock.mockReturnValue({
    data: {
      ...payload,
      audio_by_album: [{ ...payload.audio_by_album[0]!, album: "Unique" }],
    },
    loading: false,
    error: null,
  });
  render(
    <MemoryRouter>
      <ArtistStats
        artistId={7}
        catalogueAlbums={[
          {
            id: 44,
            entity_uid: "unique-album",
            name: "Unique",
            year: "2004",
            tracks: 4,
            formats: ["FLAC"],
            size_mb: 100,
            has_cover: true,
          },
        ]}
      />
    </MemoryRouter>,
  );
  const audio = screen.getByRole("group", { name: "Audio reading" });
  expect(within(audio).getByText("Unique")).toBeInTheDocument();
  expect(within(audio).getByText("2004")).toBeInTheDocument();
  expect(audio.parentElement?.querySelector("img")).toHaveAttribute(
    "src",
    albumCoverApiUrl({ albumId: 44, albumEntityUid: "unique-album" }),
  );
  expect(screen.queryByText(/Observation/)).toBeNull();
});

it("enriches ranking rows and both inspectors with safe cover/year metadata", () => {
  const release = {
    name: "Unique",
    year: "2004",
    track_count: 4,
    total_duration: 3600,
    popularity: 50,
    lastfm_listeners: 100,
  };
  statsApiMock.mockReturnValue({
    data: {
      ...payload,
      albums_timeline: [release],
      audio_by_album: [
        {
          album: "Unique",
          year: "2004",
          avg_bpm: 120,
          avg_energy: 0.5,
          avg_loudness: -8.5,
        },
      ],
      top_tracks_by_popularity: [
        {
          title: "Track",
          album: "Unique",
          popularity: 40,
          lastfm_listeners: 25,
          duration: 180,
          bpm: 120,
        },
      ],
    },
    loading: false,
  });
  render(
    <MemoryRouter>
      <ArtistStats
        artistId={7}
        catalogueAlbums={[
          {
            id: 44,
            name: "Unique",
            year: "2004",
            tracks: 4,
            formats: ["FLAC"],
            size_mb: 1,
            has_cover: true,
          },
        ]}
      />
    </MemoryRouter>,
  );
  for (const label of ["Release reading", "Audio reading"]) {
    const readout = screen.getByRole("group", { name: label });
    expect(within(readout).getByText("2004")).toBeInTheDocument();
    expect(within(readout).getByText("4")).toBeInTheDocument();
    expect(within(readout).getByText("1h 0m")).toBeInTheDocument();
    expect(within(readout).getByText("-8.5 dB")).toBeInTheDocument();
    expect(within(readout).getByText(label)).toHaveClass(
      "text-accent-action-hi",
    );
    expect(readout.parentElement?.querySelector("img")).toHaveAttribute(
      "src",
      albumCoverApiUrl({ albumId: 44 }),
    );
  }
  expect(screen.getAllByRole("meter", { name: "Energy" })).toHaveLength(2);
  const tracks = screen.getByRole("region", { name: "Track rankings" });
  expect(within(tracks).getByText(/2004/)).toBeInTheDocument();
  expect(within(tracks).getByText(/3:00/)).toBeInTheDocument();
  expect(within(tracks).getByText(/120 BPM/)).toBeInTheDocument();
  expect(tracks.querySelector("img")).toHaveAttribute(
    "src",
    albumCoverApiUrl({ albumId: 44 }),
  );
  expect(
    screen.getByRole("region", { name: "Album rankings" }).querySelector("img"),
  ).toHaveAttribute("src", albumCoverApiUrl({ albumId: 44 }));
});

it("does not add a release audio profile when same-name/year observations are ambiguous", () => {
  show({
    ...payload,
    albums_timeline: [{ name: "Same", year: "2000", track_count: 4 }],
    audio_by_album: [
      { album: "Same", year: "2000", avg_bpm: 120, avg_energy: 0.5 },
      { album: "Same", year: "2000", avg_bpm: 130, avg_energy: 0.8 },
    ],
  });
  const release = screen.getByRole("region", { name: "Release timeline" });
  expect(within(release).queryByRole("meter", { name: "Energy" })).toBeNull();
  const sonic = screen.getByRole("region", { name: "Sonic map" });
  expect(within(sonic).getByRole("meter", { name: "Energy" })).toHaveAttribute(
    "aria-valuenow",
    "0.5",
  );
  const header = (name: string) =>
    screen
      .getByRole("region", { name })
      .querySelector('[data-slot="artist-detail-header"]');
  expect(header("Track rankings")?.className).toBe(
    header("Album rankings")?.className,
  );
  expect(
    within(screen.getByRole("region", { name: "Album rankings" })).getByRole(
      "combobox",
      { name: "Album ranking unit" },
    ),
  ).toBeInTheDocument();
});

it("does not reuse a legacy undated audio reading for same-name releases in different years", async () => {
  show({
    ...payload,
    albums_timeline: [
      { name: "Same", year: "2000", track_count: 4 },
      { name: "Same", year: "2001", track_count: 5 },
    ],
    audio_by_album: [{ album: "Same", avg_bpm: 120, avg_energy: 0.5 }],
  });
  const timeline = screen.getByRole("region", { name: "Release timeline" });
  expect(within(timeline).queryByRole("meter", { name: "Energy" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Inspect Same, 2001, 5 tracks" }),
  );
  expect(within(timeline).queryByRole("meter", { name: "Energy" })).toBeNull();
  const sonic = screen.getByRole("region", { name: "Sonic map" });
  expect(within(sonic).getByRole("meter", { name: "Energy" })).toHaveAttribute(
    "aria-valuenow",
    "0.5",
  );
  const metadata = within(sonic).getByRole("group", { name: "Audio reading" });
  expect(within(metadata).queryByText("2000")).toBeNull();
  expect(within(metadata).queryByText("2001")).toBeNull();
});
