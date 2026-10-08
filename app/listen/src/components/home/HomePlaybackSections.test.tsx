import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
  }),
}));

import { HomeReplaySection } from "./HomePlaybackSections";
import type { ReplayMix } from "./home-model";

const replay: ReplayMix = {
  window: "month:2026-06",
  title: "Replay June 2026",
  subtitle: "The tracks that defined June 2026.",
  track_count: 1,
  minutes_listened: 12,
  items: [
    {
      track_id: 1,
      track_path: "/music/converge/jane-doe/concubine.flac",
      title: "Concubine",
      artist: "Converge",
      album: "Jane Doe",
      play_count: 4,
      complete_play_count: 3,
      minutes_listened: 12,
    },
  ],
};

describe("HomeReplaySection", () => {
  it("presents the monthly replay as Crate DNA", () => {
    const { container } = renderWithListenProviders(
      <HomeReplaySection
        replay={replay}
        replayPreview={replay.items}
        onOpenStats={() => undefined}
        onPlayReplay={() => undefined}
        onPlayTrack={() => undefined}
      />,
    );

    expect(screen.getAllByText("Crate DNA")).toHaveLength(1);
    expect(screen.getByText("Open Crate DNA")).toBeInTheDocument();
    expect(screen.getByText("Replay June 2026")).toBeInTheDocument();
    expect(screen.getByText("Play month replay")).toBeInTheDocument();
    expect(screen.getByText("Month replay")).toBeInTheDocument();
    expect(screen.getByText("Tracks")).toBeInTheDocument();
    expect(container.querySelector(".home-replay-card")).toBeInTheDocument();
    expect(container.querySelector(".home-replay-panel")).toBeInTheDocument();
    expect(container.querySelector(".stats-mini-tape")).not.toBeInTheDocument();
  });

  it("leads with the 30-day signal when the stats snapshot is ready", () => {
    const { container } = renderWithListenProviders(
      <HomeReplaySection
        replay={replay}
        replayPreview={replay.items}
        signal={{
          days: 30,
          minutes: 4143,
          plays: 1384,
          artists: 31,
          tape: {
            granularity: "day",
            start: "2026-06-01",
            end: "2026-06-03",
            points: [
              { bucket: "2026-06-01", minutes: 40, plays: 10 },
              { bucket: "2026-06-02", minutes: 90, plays: 22 },
            ],
            mood: [],
            peaks: [],
            months: [],
          },
        }}
        onOpenStats={() => undefined}
        onPlayReplay={() => undefined}
        onPlayTrack={() => undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "30 days of signal" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4,143")).toBeInTheDocument();
    expect(screen.getByText("1,384")).toBeInTheDocument();
    expect(screen.getByText("artists")).toBeInTheDocument();
    expect(container.querySelector(".stats-mini-tape svg rect")).not.toBeNull();
  });

  it("renders replay tracks as canonical rows with a menu", async () => {
    const onPlayTrack = vi.fn();
    renderWithListenProviders(
      <HomeReplaySection
        replay={replay}
        replayPreview={replay.items}
        onOpenStats={() => undefined}
        onPlayReplay={() => undefined}
        onPlayTrack={onPlayTrack}
      />,
    );

    const row = screen.getByRole("row", { name: "Concubine" });
    expect(row).toHaveClass("track-row");
    expect(screen.getByText("4×")).toBeInTheDocument();

    fireEvent.click(row);
    expect(onPlayTrack).toHaveBeenCalledWith(replay.items[0]);

    fireEvent.contextMenu(row);
    expect(await screen.findByText("Play now")).toBeInTheDocument();
  });
});
