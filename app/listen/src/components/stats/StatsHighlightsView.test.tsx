import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsHighlightsView } from "./StatsHighlightsView";
import type { StatsHighlights } from "./stats-types";

const highlights: StatsHighlights = {
  longest_streak: { days: 47, start: "2026-08-02", end: "2026-09-17" },
  current_streak: { days: 12 },
  new_artists: { count: 9, share: 0.21 },
  obsession: {
    day: "2026-09-14",
    plays: 31,
    minutes: 120,
    track: {
      track_id: 7,
      title: "Spectral Wound",
      artist: "Black Curse",
      album: "Burning",
    },
  },
};

describe("StatsHighlightsView", () => {
  it("plays the obsession track", () => {
    const onPlayObsession = vi.fn();
    renderWithListenProviders(
      <StatsHighlightsView
        highlights={highlights}
        onPlayObsession={onPlayObsession}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Play Spectral Wound" }),
    );
    expect(onPlayObsession).toHaveBeenCalledTimes(1);
  });

  it("hides the play action when the obsession track is not playable", () => {
    renderWithListenProviders(
      <StatsHighlightsView
        highlights={{
          ...highlights,
          obsession: {
            ...highlights.obsession!,
            track: { title: "Spectral Wound", artist: "Black Curse" },
          },
        }}
        onPlayObsession={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Play/ })).toBeNull();
  });

  it("shows streak dates", () => {
    renderWithListenProviders(<StatsHighlightsView highlights={highlights} />);
    expect(screen.getByText("Aug 2 – Sep 17")).toBeInTheDocument();
  });

  it("links new artists to movement", () => {
    renderWithListenProviders(<StatsHighlightsView highlights={highlights} />);
    expect(screen.getByRole("link", { name: /New artists/ })).toHaveAttribute(
      "href",
      "#movement",
    );
  });
});
