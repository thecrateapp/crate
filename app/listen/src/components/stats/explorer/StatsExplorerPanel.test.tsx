import { act, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  StatsRange,
  StatsRangeTrack,
} from "@/components/stats/stats-types";
import {
  StatsExplorerPanel,
  type ExplorerDayDetail,
  type StatsExplorerPanelProps,
} from "@/components/stats/explorer/StatsExplorerPanel";
import type { StretchSummary } from "@/components/stats/explorer/stats-explorer-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const STRETCH = { start: "2026-09-01", end: "2026-09-30" };
const SUMMARY: StretchSummary = {
  buckets: 30,
  minutes: 1500,
  average: 50,
  silent: 4,
  energy: 0.7,
  valence: 0.3,
};

function range(overrides: Partial<StatsRange> = {}): StatsRange {
  return {
    start: STRETCH.start,
    end: STRETCH.end,
    available: true,
    top_artists: [],
    top_albums: [],
    top_tracks: [],
    discoveries: [],
    ...overrides,
  };
}

const LOADED = range({
  top_artists: [
    {
      artist_name: "Low",
      artist_id: 4,
      artist_slug: "low",
      minutes: 630,
      plays: 120,
      share: 0.42,
    },
  ],
  top_albums: [
    {
      album: "Things We Lost in the Fire",
      artist: "Low",
      album_id: 3,
      album_slug: "things-we-lost-in-the-fire",
      minutes: 300,
    },
  ],
  top_tracks: [
    {
      track_id: 7,
      title: "Sunflower",
      artist: "Low",
      album: "Things We Lost in the Fire",
      album_id: 3,
      plays: 14,
      minutes: 60,
    },
  ],
  discoveries: [
    { artist_name: "Duster", first_day: "2026-09-12", minutes: 40 },
  ],
});

type PanelProps = Partial<StatsExplorerPanelProps>;

function panel(props: PanelProps = {}) {
  return (
    <StatsExplorerPanel
      granularity="day"
      stretch={STRETCH}
      summary={SUMMARY}
      data={null}
      loading={false}
      available
      day={null}
      onBack={() => {}}
      onPlayTrack={() => {}}
      {...props}
    />
  );
}

/** Renders inside the Listen providers and swaps props without leaving them. */
function renderPanel(initial: PanelProps) {
  let update: (props: PanelProps) => void = () => {};
  function Host() {
    const [props, setProps] = useState(initial);
    update = setProps;
    return panel(props);
  }
  const result = renderWithListenProviders(<Host />, { locale: "en" });
  return {
    ...result,
    rerender: (props: PanelProps) => act(() => update(props)),
  };
}

describe("StatsExplorerPanel", () => {
  it("shows client numbers instantly and server blocks after loading", () => {
    const { container, rerender } = renderPanel({ loading: true });
    const aside = container.querySelector("aside")!;
    expect(aside).toHaveAttribute("aria-live", "polite");
    expect(aside).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("In this stretch")).toBeInTheDocument();
    expect(screen.getByText("Sep 1 – Sep 30")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getByText("25h")).toBeInTheDocument();
    expect(screen.getByText("Average 50m/day")).toBeInTheDocument();
    expect(screen.getByText("4 days without listening")).toBeInTheDocument();
    expect(screen.getByText("Intense")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute(
      "aria-valuetext",
      "70%",
    );
    expect(screen.getByRole("meter", { name: "Valence" })).toHaveAttribute(
      "aria-valuetext",
      "30%",
    );
    expect(screen.queryByText("Low")).not.toBeInTheDocument();

    rerender({ data: LOADED });
    expect(aside).not.toHaveAttribute("aria-busy", "true");
    const artist = screen.getByRole("region", {
      name: "Artist of the stretch",
    });
    expect(within(artist).getByText("Low")).toBeInTheDocument();
    expect(within(artist).getByText("10h 30m · 42%")).toBeInTheDocument();
    expect(within(artist).getByRole("link")).toHaveAttribute(
      "href",
      "/artists/low",
    );
    const album = screen.getByRole("region", { name: "Album of the stretch" });
    expect(
      within(album).getByText("Things We Lost in the Fire"),
    ).toBeInTheDocument();
    const track = screen.getByRole("region", { name: "Most played track" });
    expect(within(track).getByText("Sunflower")).toBeInTheDocument();
    expect(within(track).getByText("14 plays")).toBeInTheDocument();
    const discoveries = screen.getByRole("region", { name: "Discoveries" });
    expect(within(discoveries).getByText(/Duster/)).toBeInTheDocument();
  });

  it("renders an empty stretch", () => {
    const { container } = renderWithListenProviders(
      panel({
        summary: {
          buckets: 30,
          minutes: 0,
          average: 0,
          silent: 30,
          energy: null,
          valence: null,
        },
        data: range(),
      }),
      { locale: "en" },
    );

    expect(screen.getByText("0m")).toBeInTheDocument();
    expect(screen.getByText("Average 0m/day")).toBeInTheDocument();
    expect(screen.getByText("30 days without listening")).toBeInTheDocument();
    const mood = screen.getByRole("region", { name: "Mood of the stretch" });
    expect(within(mood).getByText("—")).toBeInTheDocument();
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
    expect(screen.getByText("None in this stretch")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Artist of the stretch" }),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|0%/);
  });

  it("shows the unavailable notice", () => {
    renderWithListenProviders(
      panel({ data: range({ available: false }), available: false }),
      { locale: "en" },
    );

    expect(
      screen.getByText("Top items for this stretch are still being prepared."),
    ).toBeInTheDocument();
    expect(screen.getByText("25h")).toBeInTheDocument();
    expect(screen.queryByText("None in this stretch")).not.toBeInTheDocument();
  });

  it("hides silent days on weekly tapes", () => {
    renderWithListenProviders(panel({ granularity: "week" }), {
      locale: "en",
    });

    expect(screen.getByText("Average 50m/day")).toBeInTheDocument();
    expect(
      screen.queryByText("4 days without listening"),
    ).not.toBeInTheDocument();
  });

  it("lists the day's tracks and returns to the stretch", () => {
    const tracks: StatsRangeTrack[] = [
      {
        track_id: 7,
        title: "Sunflower",
        artist: "Low",
        album: "Things We Lost in the Fire",
        album_id: 3,
        plays: 3,
        minutes: 12,
      },
      {
        track_id: null,
        title: "Unknown Song",
        artist: "Nobody",
        album: "",
        plays: 1,
        minutes: 3,
      },
    ];
    const day: ExplorerDayDetail = {
      bucket: "2026-09-12",
      start: "2026-09-12",
      end: "2026-09-12",
      minutes: 95,
      plays: 21,
      tracks,
      loading: false,
      error: false,
      available: true,
    };
    const onBack = vi.fn();
    const onPlayTrack = vi.fn();
    const { rerender } = renderPanel({
      day,
      onBack,
      onPlayTrack,
      data: LOADED,
    });

    expect(screen.getByText("Day in detail")).toBeInTheDocument();
    expect(screen.getByText("Saturday, September 12")).toBeInTheDocument();
    expect(screen.getByText("1h 35m")).toBeInTheDocument();
    expect(screen.getByText("21 plays")).toBeInTheDocument();
    expect(screen.queryByText("In this stretch")).not.toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Sunflower")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3 plays")).toBeInTheDocument();

    const play = screen.getAllByRole("button", { name: "Play now" });
    expect(play).toHaveLength(1);
    fireEvent.click(play[0]!);
    expect(onPlayTrack).toHaveBeenCalledWith(tracks[0]);

    fireEvent.click(
      screen.getByRole("button", { name: "Back to the stretch" }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender({ day: { ...day, minutes: 0, plays: 0, tracks: [] } });
    expect(screen.getByText("Nothing played that day.")).toBeInTheDocument();

    rerender({
      granularity: "week",
      day: {
        ...day,
        bucket: "2026-09-07",
        start: "2026-09-07",
        end: "2026-09-13",
      },
    });
    expect(screen.getByText("Week in detail")).toBeInTheDocument();
    expect(screen.getByText("Sep 7 – Sep 13")).toBeInTheDocument();
  });

  it("shows a failure line when the stretch cannot load", () => {
    const { container } = renderWithListenProviders(panel({ error: true }), {
      locale: "en",
    });

    expect(
      screen.getByText("This stretch could not be loaded."),
    ).toBeInTheDocument();
    // Client numbers stay; server blocks never pretend to be empty.
    expect(screen.getByText("25h")).toBeInTheDocument();
    expect(screen.queryByText("None in this stretch")).not.toBeInTheDocument();
    expect(container.querySelector("aside")).not.toHaveAttribute("aria-busy");
  });

  it("shows a failure line when the day cannot load", () => {
    renderWithListenProviders(
      panel({
        day: {
          bucket: "2026-09-12",
          start: "2026-09-12",
          end: "2026-09-12",
          minutes: 95,
          plays: 21,
          tracks: [],
          loading: false,
          error: true,
          available: true,
        },
      }),
      { locale: "en" },
    );

    expect(
      screen.getByText("This stretch could not be loaded."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing played that day."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("21 plays")).toBeInTheDocument();
  });

  it("dims the previous stretch while the next one loads", () => {
    const { container } = renderWithListenProviders(
      panel({ data: LOADED, stale: true, loading: true }),
      { locale: "en" },
    );

    const artist = screen.getByRole("region", {
      name: "Artist of the stretch",
    });
    expect(within(artist).getByText("Low")).toBeInTheDocument();
    expect(container.querySelector(".stats-explorer-server")).toHaveAttribute(
      "data-stale",
      "true",
    );
    expect(container.querySelector("aside")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // Fresh numbers for the new stretch are not dimmed.
    expect(screen.getByText("25h").closest("[data-stale]")).toBeNull();
  });
});
