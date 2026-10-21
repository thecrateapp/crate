import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsHighlights } from "./StatsHighlights";
import { toPlayerTrack } from "./stats-model";
import type { StatsHighlights as Highlights } from "./stats-types";

const highlights: Highlights = {
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

describe("StatsHighlights adapter", () => {
  it("plays the obsession track as a one-track playlist", () => {
    const playAll = vi.fn();
    renderWithListenProviders(<StatsHighlights highlights={highlights} />, {
      playerActions: { playAll },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Play Spectral Wound" }),
    );
    expect(playAll).toHaveBeenCalledTimes(1);
    const [tracks, index, source] = playAll.mock.calls[0]!;
    expect(index).toBe(0);
    expect(source).toEqual({ type: "playlist", name: "Spectral Wound" });
    expect(tracks).toEqual([
      toPlayerTrack({
        ...highlights.obsession!.track,
        plays: 31,
        minutes: 120,
      }),
    ]);
  });
});
