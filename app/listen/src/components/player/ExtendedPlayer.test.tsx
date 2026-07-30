import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPlayerActions,
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

import { ExtendedPlayer } from "./ExtendedPlayer";

const useIsDesktopMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: useIsDesktopMock,
}));

vi.mock("@/components/player/SpinningDisc", () => ({
  SpinningDisc: () => <div data-testid="spinning-disc" />,
}));

vi.mock("@/components/player/PlayerTrackIdentity", () => ({
  PlayerTrackIdentity: () => <div data-testid="player-track-identity" />,
}));

vi.mock("@/components/player/bar/PlayerSeekBar", () => ({
  PlayerSeekBar: () => <div data-testid="seek-bar" />,
}));

vi.mock("@/components/player/extended/QueueTab", () => ({
  QueueTab: () => <div data-testid="queue-tab" />,
}));

vi.mock("@/components/player/extended/LyricsTab", () => ({
  LyricsTab: () => null,
}));

vi.mock("@/components/player/extended/SuggestedTab", () => ({
  SuggestedTab: () => null,
}));

vi.mock("@/components/player/extended/InfoTab", () => ({
  InfoTab: () => null,
}));

vi.mock("@/components/player/useResolvedPlayerArtist", () => ({
  useResolvedPlayerArtist: () => ({
    resolvedArtist: null,
    artistAvatarUrl: null,
    markArtistPhotoFailed: vi.fn(),
  }),
}));

vi.mock("@/components/player/player-source", () => ({
  getPlaySourceLabel: () => null,
}));

vi.mock("@/components/player/visualizer/useMusicVisualizer", () => ({
  useMusicVisualizer: () => undefined,
}));

vi.mock("@/components/player/visualizer/useVisualizerConfig", () => ({
  useVisualizerConfig: () => ({
    surfaceMode: "cd",
    useAlbumPalette: false,
    trackVizProfile: { hasAnalysis: false, summary: null },
    setSurfaceMode: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (
    _transition: unknown,
    time: number,
    duration: number,
  ) => ({
    displayedTime: time,
    displayedDuration: duration,
  }),
}));

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-escape-key", () => ({
  useEscapeKey: vi.fn(),
}));

describe("ExtendedPlayer", () => {
  beforeEach(() => {
    localStorage.removeItem("listen-eq-enabled");
    useIsDesktopMock.mockReturnValue(true);
  });

  it("hides the desktop Equalizer access when it is globally disabled", () => {
    localStorage.setItem("listen-eq-enabled", "false");
    const track = createMockTrack({
      id: "extended-eq-track",
      entityUid: "extended-eq-track",
      title: "Extended EQ",
      artist: "Crate",
    });

    renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(screen.queryByLabelText("Equalizer")).not.toBeInTheDocument();
  });
});
