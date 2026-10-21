import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsArtistOfPeriodView } from "./StatsArtistOfPeriodView";
import type { StatsArtistOfPeriod } from "./stats-types";

const artist: StatsArtistOfPeriod = {
  artist_name: "Converge",
  plays: 40,
  minutes: 200,
  active_days: 9,
  first_day_in_period: "2026-09-04",
  first_ever_day: "2019-03-02",
};

function renderHero(
  override: Partial<StatsArtistOfPeriod>,
  props: { periodStart?: string | null; allTime?: boolean } = {},
) {
  return renderWithListenProviders(
    <StatsArtistOfPeriodView
      artist={{ ...artist, ...override }}
      href="/artist"
      artwork={null}
      {...props}
    />,
  );
}

describe("StatsArtistOfPeriodView origin line", () => {
  it("hero says listening since or discovered", () => {
    const since = renderHero({}, { periodStart: "2026-09-01" });
    expect(screen.getByText("Listening since 2019")).toBeInTheDocument();
    expect(screen.queryByText("Discovered this period")).toBeNull();
    since.unmount();

    const discovered = renderHero(
      { first_ever_day: "2026-09-04" },
      { periodStart: "2026-09-01" },
    );
    expect(screen.getByText("Discovered this period")).toBeInTheDocument();
    discovered.unmount();

    const edge = renderHero(
      { first_ever_day: "2026-09-01" },
      { periodStart: "2026-09-01" },
    );
    expect(screen.getByText("Discovered this period")).toBeInTheDocument();
    edge.unmount();

    const allTime = renderHero(
      { first_ever_day: "2026-09-04" },
      { periodStart: "2026-09-01", allTime: true },
    );
    expect(screen.getByText("Listening since 2026")).toBeInTheDocument();
    allTime.unmount();

    renderHero({ first_ever_day: null }, { periodStart: "2026-09-01" });
    expect(screen.queryByText(/Listening since|Discovered/)).toBeNull();
  });
});
