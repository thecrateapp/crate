import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsReplayCard } from "./StatsReplayCard";
import type { ReplayMix, StatsTrack } from "./stats-types";

function track(id: number): StatsTrack {
  return {
    track_id: id,
    track_path: null,
    title: `Track ${id}`,
    artist: "Artist",
    album: `Album ${id}`,
    play_count: 1,
    complete_play_count: 1,
    minutes_listened: 3,
  };
}

const replay: ReplayMix = {
  window: "30d",
  title: "Replay",
  subtitle: "Snapshot",
  title_key: "stats.replay.thisMonth.title",
  track_count: 25,
  minutes_listened: 95,
  items: [1, 2, 3, 4, 5].map(track),
};

describe("StatsReplayCard", () => {
  it("replay card plays and shuffles", () => {
    const onPlay = vi.fn();
    const onShuffle = vi.fn();
    const { container } = renderWithListenProviders(
      <StatsReplayCard
        replay={replay}
        onPlay={onPlay}
        onShuffle={onShuffle}
        coverUrl={(item) => `/cover/${item.track_id}.jpg`}
      />,
    );
    expect(screen.getByText("Replay this month")).toBeInTheDocument();
    expect(screen.getByText(/25 tracks/)).toBeInTheDocument();
    expect(screen.getByText(/1h 35m/)).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onShuffle).toHaveBeenCalledTimes(1);
  });
});
