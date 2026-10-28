import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { SonicReport, SonicTrack } from "./insights-model";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@crate/ui/lib/read-css-color", () => ({
  readCssColorToken: () => "#123456",
}));
vi.mock("@nivo/scatterplot", async (original) => {
  const actual = await original<typeof import("@nivo/scatterplot")>();
  return {
    ...actual,
    ResponsiveScatterPlot: (
      props: ComponentProps<typeof actual.ScatterPlot>,
    ) => <actual.ScatterPlot {...props} width={500} height={360} />,
  };
});
import { InsightSonicExplorer } from "./InsightSonicExplorer";

const track = (id: number, title: string): SonicTrack => ({
  id,
  entity_uid: `track-${id}`,
  title,
  album_id: id,
  album_entity_uid: `album-${id}`,
  album: `Album ${id}`,
  album_slug: `album-${id}`,
  artist: "Caspian",
  artist_slug: "caspian",
  year: "2025",
  has_cover: true,
  heard: id === 1,
  plays: id === 1 ? 4 : 0,
  minutes: id === 1 ? 20 : 0,
  bpm: 120,
  bpm_confidence: 0.9,
  energy: 0.4,
  integrated_lufs: -14,
  true_peak_dbfs: -1.2,
  key_camelot: "8A",
  key_confidence: 0.7,
  tempo_stability: 0.8,
  quality: "partial",
  has_bliss: true,
  acousticness: 0.1,
  instrumentalness: null,
  valence: 0.3,
});
const fixture = (): SonicReport => ({
  version: 1,
  source: {
    analyzer_version: "analyzer-4",
    profile_version: 3,
    measurement_version: "measure-2",
  },
  planes: [
    {
      key: "tempo_energy",
      x: { label: "Tempo", unit: "BPM", min: 0, max: 200, bins: 10 },
      y: { label: "Smart Mix energy", unit: "", min: 0, max: 1, bins: 8 },
      coverage: {
        catalogue_tracks: 100,
        paired_tracks: 80,
        heard_tracks: 20,
        paired_heard_tracks: 10,
      },
      cells: [
        {
          id: "tempo_energy:5:3",
          column: 5,
          row: 3,
          x_min: 100,
          x_max: 120,
          y_min: 0.375,
          y_max: 0.5,
          tracks: 60,
          albums: 6,
          heard_tracks: 8,
          heard_albums: 2,
          plays: 20,
          minutes: 100,
          catalogue_share: 75,
          listening_share: 80,
          examples: [track(1, "Waves"), track(2, "Echoes")],
        },
        {
          id: "tempo_energy:6:4",
          column: 6,
          row: 4,
          x_min: 120,
          x_max: 140,
          y_min: 0.5,
          y_max: 0.625,
          tracks: 20,
          albums: 3,
          heard_tracks: 2,
          heard_albums: 1,
          plays: 2,
          minutes: 10,
          catalogue_share: 25,
          listening_share: 20,
          examples: [track(3, "Tides")],
        },
      ],
    },
    {
      key: "tempo_lufs",
      x: { label: "Tempo", unit: "BPM", min: 0, max: 200, bins: 10 },
      y: {
        label: "Integrated loudness",
        unit: "LUFS",
        min: -30,
        max: 0,
        bins: 8,
      },
      coverage: {
        catalogue_tracks: 100,
        paired_tracks: 70,
        heard_tracks: 20,
        paired_heard_tracks: 5,
      },
      cells: [
        {
          id: "tempo_lufs:5:4",
          column: 5,
          row: 4,
          x_min: 100,
          x_max: 120,
          y_min: -15,
          y_max: -11.25,
          tracks: 70,
          albums: 8,
          heard_tracks: 5,
          heard_albums: 2,
          plays: 10,
          minutes: 50,
          catalogue_share: 100,
          listening_share: 100,
          examples: [track(1, "Waves")],
        },
      ],
    },
  ],
});
const refresh = vi.fn();
function view(
  report: SonicReport | null = fixture(),
  window: "30d" | "90d" = "30d",
  active = true,
) {
  return (
    <MemoryRouter>
      <InsightSonicExplorer
        report={report}
        window={window}
        onRefresh={refresh}
        refreshing={false}
        active={active}
      />
    </MemoryRouter>
  );
}
beforeEach(() => {
  apiMock
    .mockReset()
    .mockResolvedValue({ seed_track_id: 1, available: true, items: [] });
  refresh.mockReset();
});
describe("Sonic explorer", () => {
  it("uses shared selectable rows for region examples", async () => {
    render(view());
    await screen.findByText("No eligible nearby tracks found.");
    const sample = screen.getByRole("button", {
      name: "Inspect Waves by Caspian",
    });
    expect(sample.parentElement).toHaveAttribute("data-slot", "hairline-row");
    expect(sample.parentElement).toHaveAttribute("data-active", "true");
    expect(sample.querySelector(".truncate")).toBeNull();
  });

  it("cancels nearby sound while its tab is hidden and rejects the late result", async () => {
    let finish!: (result: unknown) => void;
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(view());
    const signal = apiMock.mock.calls[0]![3].signal as AbortSignal;
    rerender(view(fixture(), "30d", false));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish({
        seed_track_id: 1,
        available: true,
        items: [{ track: track(9, "Hidden obsolete neighbor"), distance: 0.1 }],
      }),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
    rerender(view());
    expect(
      await screen.findByText("No eligible nearby tracks found."),
    ).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("Hidden obsolete neighbor"),
    ).not.toBeInTheDocument();
  });

  it("opens the most-heard region and preserves an explicit user selection after refresh", async () => {
    const report = fixture();
    report.planes[0]!.cells.reverse();
    // More heard tracks must win even over the larger catalogue population.
    report.planes[0]!.cells[0]!.tracks = 60;
    report.planes[0]!.cells[1]!.tracks = 20;
    const { rerender } = render(view(report));
    const map = screen.getByRole("slider", { name: "Inspect sonic region" });
    expect(map).toHaveAttribute("aria-valuenow", "2");
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("20 tracks");
    map.focus();
    await userEvent.keyboard("{Home}");
    const refreshed = fixture();
    refreshed.planes[0]!.cells.reverse();
    refreshed.planes[0]!.cells[1]!.heard_tracks = 100;
    rerender(view(refreshed));
    expect(map).toHaveAttribute("aria-valuenow", "1");
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("20 tracks");
  });
  it.each([20, 60])(
    "opens the largest catalogue region without listening and breaks ties by stable ID (other region %i tracks)",
    (otherTracks) => {
      const report = fixture();
      report.planes[0]!.cells.reverse();
      for (const cell of report.planes[0]!.cells) cell.heard_tracks = 0;
      report.planes[0]!.cells[0]!.tracks = otherTracks;
      render(view(report));
      expect(
        screen.getByRole("slider", { name: "Inspect sonic region" }),
      ).toHaveAttribute("aria-valuenow", "2");
    },
  );
  it("distinguishes a small positive region share from a true zero", () => {
    const report = fixture();
    report.planes[0]!.cells[0]!.catalogue_share = 0.0044;
    report.planes[0]!.cells[0]!.listening_share = 0;
    render(view(report));
    const reading = screen.getByRole("group", {
      name: "Selected sonic region",
    });
    expect(reading).toHaveTextContent("<0.1% of paired catalogue");
    expect(reading).toHaveTextContent("0% of paired heard tracks");
  });
  it("shows a refresh affordance for older snapshots without a sonic report", async () => {
    render(view(null));
    expect(
      screen.getByText(/Sonic measurements are not included in this snapshot/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh sonic report" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("shows pair-specific full catalogue and heard denominators and measured source", async () => {
    render(view());
    const coverage = screen.getByRole("group", {
      name: "Sonic measurement coverage",
    });
    expect(coverage).toHaveTextContent("80 / 100 indexed tracks");
    expect(coverage).toHaveTextContent("10 / 20 heard tracks");
    expect(screen.getByText(/analyzer-4.*profile 3/)).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Inspect sonic region" }),
    ).toHaveAttribute("aria-valuetext", expect.stringContaining("0.375–0.5"));
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("0.375–0.5");
    await userEvent.click(screen.getByRole("radio", { name: "Tempo × LUFS" }));
    expect(coverage).toHaveTextContent("70 / 100 indexed tracks");
    expect(coverage).toHaveTextContent("5 / 20 heard tracks");
    expect(screen.getByText(/Verified LUFS.*measure-2/)).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Inspect sonic region" }),
    ).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("-15–-11.25 LUFS"),
    );
  });
  it("plots every exact occupied region with common area scale and explicit cohorts", () => {
    const { container } = render(view());
    const regions = container.querySelector(
      '[data-admin-instrument="insights-sonic-regions"]',
    )!;
    expect(regions.querySelectorAll("[data-sonic-cell]")).toHaveLength(2);
    expect(screen.getByText(/Area.*paired unique-track share/)).toBeVisible();
    expect(screen.getByRole("radio", { name: "Contrast" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const catalogue = regions.querySelector('[data-sonic-cohort="catalogue"]')!;
    const heard = regions.querySelector('[data-sonic-cohort="listening"]')!;
    const catalogueRadius = Number(catalogue.getAttribute("r"));
    const heardRadius = Number(heard.getAttribute("r"));
    expect(catalogueRadius ** 2 / heardRadius ** 2).toBeCloseTo(75 / 80);
    // Centre of bin 5/3 on explicit 0..200 / 0..1 scales; Nivo must not "nice" them.
    expect(regions.querySelector("[data-sonic-cell]")).toHaveAttribute(
      "transform",
      "translate(245.3,168.75)",
    );
  });
  it("changes visible cohorts without changing cell geometry or selected reading", async () => {
    const { container } = render(view());
    const before = container
      .querySelector("[data-sonic-cell]")!
      .getAttribute("transform");
    await userEvent.click(screen.getByRole("radio", { name: "Heard tracks" }));
    expect(
      container.querySelectorAll('[data-sonic-cohort="catalogue"]'),
    ).toHaveLength(0);
    expect(container.querySelector("[data-sonic-cell]")).toHaveAttribute(
      "transform",
      before,
    );
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("60 tracks");
    await userEvent.click(screen.getByRole("radio", { name: "Catalogue" }));
    expect(
      container.querySelectorAll('[data-sonic-cohort="listening"]'),
    ).toHaveLength(0);
  });
  it("keeps a persistent exact region and track reading through keyboard selection", async () => {
    render(view());
    const map = screen.getByRole("slider", { name: "Inspect sonic region" });
    map.focus();
    await userEvent.keyboard("{End}");
    expect(map).toHaveAttribute("aria-valuenow", "2");
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("20 tracks");
    expect(
      screen.getByRole("button", { name: /Inspect Tides/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Home}");
    await userEvent.click(
      screen.getByRole("button", { name: /Inspect Echoes/ }),
    );
    const reading = screen.getByRole("group", { name: "Selected sonic track" });
    expect(reading).toHaveTextContent("Echoes");
    expect(reading).toHaveTextContent("Partial");
    expect(reading).toHaveTextContent("120 BPM");
    expect(screen.getByRole("link", { name: "Open Album 2" })).toHaveAttribute(
      "href",
      expect.stringContaining("album-2"),
    );
    expect(screen.getByRole("link", { name: "Open Caspian" })).toHaveAttribute(
      "href",
      expect.stringContaining("caspian"),
    );
    expect(
      screen.getByText(/Estimated traits.*not measured probabilities/),
    ).toBeVisible();
  });
  it("marks null measurements unavailable rather than treating them as zero", () => {
    const report = fixture();
    Object.assign(report.planes[0]!.cells[0]!.examples[0]!, {
      bpm_confidence: null,
      integrated_lufs: null,
      tempo_stability: null,
      key_camelot: null,
      acousticness: null,
      valence: null,
    });
    render(view(report));
    expect(
      screen.getByRole("group", { name: "Selected sonic track" }),
    ).toHaveTextContent("Unavailable");
    expect(screen.queryByText("0 LUFS")).not.toBeInTheDocument();
  });
  it("does not imply compatibility from Bliss cosine distances", async () => {
    apiMock.mockResolvedValue({
      seed_track_id: 1,
      available: true,
      items: [{ track: track(4, "Nearby"), distance: 0.138 }],
    });
    render(view());
    const neighbors = await screen.findByRole("group", {
      name: "Sound nearby",
    });
    expect(within(neighbors).getByText("Nearby")).toBeVisible();
    expect(neighbors).toHaveTextContent("Cosine distance 0.138");
    expect(neighbors).toHaveTextContent("not mixing compatibility");
    expect(neighbors).not.toHaveTextContent("86.2%");
  });
  it("supports retry after neighbor failure and honest unavailable vectors", async () => {
    apiMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ seed_track_id: 1, available: false, items: [] });
    render(view());
    expect(
      await screen.findByText(/Nearby sound could not be loaded/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry nearby sound" }),
    );
    expect(
      await screen.findByText(/No valid stored Bliss vector/),
    ).toBeVisible();
  });
  it("does not request neighbors for a known missing vector", () => {
    const report = fixture();
    report.planes[0]!.cells[0]!.examples[0]!.has_bliss = false;
    render(view(report));
    expect(screen.getByText(/No stored Bliss vector/)).toBeVisible();
    expect(apiMock).not.toHaveBeenCalled();
  });
  it("rejects an obsolete neighbor response after changing track or listening period", async () => {
    let resolveFirst!: (value: unknown) => void;
    apiMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({
        seed_track_id: 2,
        available: true,
        items: [{ track: track(8, "Current neighbor"), distance: 0.2 }],
      });
    const { rerender } = render(view());
    const firstSignal = apiMock.mock.calls[0]![3].signal as AbortSignal;
    await userEvent.click(
      screen.getByRole("button", { name: /Inspect Echoes/ }),
    );
    expect(firstSignal.aborted).toBe(true);
    expect(await screen.findByText("Current neighbor")).toBeVisible();
    await act(async () =>
      resolveFirst({
        seed_track_id: 1,
        available: true,
        items: [{ track: track(9, "Obsolete neighbor"), distance: 0.1 }],
      }),
    );
    expect(screen.queryByText("Obsolete neighbor")).not.toBeInTheDocument();
    rerender(view(fixture(), "90d"));
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("window=90d&limit=6"),
      "GET",
      undefined,
      { signal: expect.any(AbortSignal) },
    );
  });
  it("supports empty measurement pairs and zero heard coverage without inventing shares", () => {
    const report = fixture();
    report.planes[0]!.cells = [];
    report.planes[0]!.coverage = {
      catalogue_tracks: 100,
      paired_tracks: 0,
      heard_tracks: 0,
      paired_heard_tracks: 0,
    };
    const { container } = render(view(report));
    expect(screen.getByText(/No current paired measurements/)).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Sonic measurement coverage" }),
    ).toHaveTextContent("0 / 0 heard tracks");
    expect(container.querySelector("[title]")).toBeNull();
  });
  it("pins pointer regions independently of hover preview", () => {
    render(view());
    const map = screen.getByRole("slider", { name: "Inspect sonic region" });
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 500,
      height: 360,
      bottom: 360,
      right: 500,
      toJSON() {},
    });
    fireEvent.pointerMove(map, { clientX: 333, clientY: 155 });
    expect(screen.getByText(/Preview · 120–140 BPM/)).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("60 tracks");
    fireEvent.pointerUp(map, { clientX: 333, clientY: 155 });
    fireEvent.pointerLeave(map);
    expect(map).toHaveAttribute("aria-valuenow", "2");
  });
  it("keeps catalogue cells visible but draws no heard area when no paired track was heard", async () => {
    const report = fixture();
    report.planes[0]!.coverage.paired_heard_tracks = 0;
    for (const cell of report.planes[0]!.cells) {
      cell.heard_tracks = 0;
      cell.heard_albums = 0;
      cell.listening_share = 0;
    }
    const { container } = render(view(report));
    expect(
      container.querySelectorAll('[data-sonic-cohort="catalogue"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-sonic-cohort="listening"]'),
    ).toHaveLength(0);
    expect(
      screen.getByRole("group", { name: "Selected sonic region" }),
    ).toHaveTextContent("No paired listening");
    await userEvent.click(screen.getByRole("radio", { name: "Heard tracks" }));
    expect(container.querySelectorAll("[data-sonic-cohort]")).toHaveLength(0);
  });
  it("withholds previous-period neighbors immediately and ignores a late response after a window switch", async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveCurrent!: (value: unknown) => void;
    apiMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrent = resolve;
          }),
      );
    const { rerender } = render(view());
    const signal = apiMock.mock.calls[0]![3].signal as AbortSignal;
    rerender(view(fixture(), "90d"));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolveOld({
        seed_track_id: 1,
        available: true,
        items: [{ track: track(9, "Old period neighbor"), distance: 0.1 }],
      }),
    );
    expect(screen.queryByText("Old period neighbor")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading nearby sound",
    );
    await act(async () =>
      resolveCurrent({ seed_track_id: 1, available: true, items: [] }),
    );
    expect(screen.getByText("No eligible nearby tracks found.")).toBeVisible();
  });
});
