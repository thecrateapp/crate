import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import { setEqualizerEnabled } from "@/lib/equalizer-prefs";

import { PlayerBar } from "./PlayerBar";

const useIsDesktopMock = vi.hoisted(() => vi.fn(() => false));
const isLikedMock = vi.hoisted(() => vi.fn(() => false));
const likeTrackMock = vi.hoisted(() => vi.fn(async () => true));
const unlikeTrackMock = vi.hoisted(() => vi.fn(async () => true));
const triggerHapticMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: useIsDesktopMock,
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: isLikedMock,
    likeTrack: likeTrackMock,
    unlikeTrack: unlikeTrackMock,
  }),
}));

vi.mock("@/hooks/use-audio-visualizer", () => ({
  useAudioVisualizer: () => ({ frequenciesDb: [], sampleRate: 48_000 }),
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (
    _transition: unknown,
    time: number,
    dur: number,
  ) => ({
    displayedTime: time,
    displayedDuration: dur,
  }),
}));

vi.mock("@/hooks/use-crate-connect-enabled", () => ({
  useCrateConnectEnabled: () => false,
}));

vi.mock("@/hooks/use-track-info", () => ({
  useTrackInfo: () => ({ info: null, loading: false }),
}));

vi.mock("@/hooks/use-track-playback", () => ({
  useTrackPlayback: () => ({ resolution: null, loading: false }),
}));

vi.mock("@/lib/crate-connect", () => ({
  CONNECT_SESSION_EVENT: "crate:connect-session",
  CRATE_CONNECT_V2_TRANSPORT_ENABLED: false,
  fetchActiveConnectSnapshot: vi.fn(async () => ({
    session: null,
    state: null,
  })),
  fetchConnectDevices: vi.fn(async () => ({ devices: [] })),
  sendConnectCommand: vi.fn(async () => true),
}));

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: triggerHapticMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@/components/player/lazy-player-surfaces", () => ({
  LazyEqualizerPopover: () => null,
  LazyExtendedPlayer: () => null,
  LazyFullscreenPlayer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="fullscreen-player" /> : null,
  LazyLyricsPanel: () => null,
  LazyQueuePanel: () => null,
  preloadEqualizerPopover: vi.fn(),
  preloadExtendedPlayer: vi.fn(),
  preloadFullscreenPlayer: vi.fn(),
  preloadLyricsPanel: vi.fn(),
  preloadQueuePanel: vi.fn(),
}));

vi.mock("@/components/player/bar/PlayerTrackMenu", () => ({
  PlayerTrackMenu: () => <div data-testid="player-track-menu" />,
}));

vi.mock("@/components/player/bar/PlayerVolumeControl", () => ({
  PlayerVolumeControl: () => <div data-testid="player-volume-control" />,
}));

vi.mock("@/components/player/PlaybackTargetMenu", () => ({
  PlaybackTargetMenu: () => <div data-testid="playback-target-menu" />,
}));

vi.mock("@/components/player/bar/WaveformCanvas", () => ({
  WaveformCanvas: () => <canvas data-testid="waveform-canvas" />,
}));

vi.mock("@/components/player/player-gestures", () => ({
  getHorizontalPlayerSwipeAction: vi.fn(() => null),
}));

describe("PlayerBar mobile mini-player", () => {
  beforeEach(() => {
    useIsDesktopMock.mockReturnValue(false);
    localStorage.removeItem("listen-eq-enabled");
    isLikedMock.mockReturnValue(false);
    likeTrackMock.mockClear();
    unlikeTrackMock.mockClear();
    triggerHapticMock.mockClear();
    toastSuccessMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render like or contextual actions in the mobile mini-player", () => {
    const track = createMockTrack({
      title: "No Buttons",
      artist: "Tidal Mode",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.queryByLabelText("Like track")).toBeNull();
    expect(screen.queryByTestId("player-track-menu")).toBeNull();
  });

  it("leaves the mobile dock glass to the shared Shell backdrop", () => {
    const track = createMockTrack({
      title: "Glass Dock",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(container.querySelector(".listen-mobile-player-glass")).toBeNull();
  });

  it("keeps the desktop PlayerBar off the mobile dock glass surface", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Desktop Surface",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(container.querySelector(".listen-mobile-player-glass")).toBeNull();
  });

  it("hides the desktop Equalizer access when the global toggle is disabled", async () => {
    useIsDesktopMock.mockReturnValue(true);
    localStorage.setItem("listen-eq-enabled", "true");
    const track = createMockTrack({
      title: "Desktop EQ",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.getByLabelText("Equalizer")).toBeInTheDocument();

    setEqualizerEnabled(false);

    await waitFor(() => {
      expect(screen.queryByLabelText("Equalizer")).not.toBeInTheDocument();
    });
  });

  it("likes the current track with a long press on the cover", async () => {
    vi.useFakeTimers();
    const track = createMockTrack({
      id: "track-long-press",
      entityUid: "track-uid",
      libraryTrackId: 42,
      path: "/music/long-press.flac",
      title: "Long Press Song",
      artist: "Crate",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    fireEvent.touchStart(screen.getByLabelText("Track artwork"), {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    await vi.advanceTimersByTimeAsync(550);

    expect(likeTrackMock).toHaveBeenCalledWith(
      42,
      "track-uid",
      "/music/long-press.flac",
      null,
    );
    expect(triggerHapticMock).toHaveBeenCalledWith("selection");
    expect(toastSuccessMock).toHaveBeenCalledWith("Added to liked tracks");
  });

  it("shows a liked indicator on the cover when the current track is liked", () => {
    isLikedMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Liked Song",
      artist: "Crate",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.getByLabelText("Liked track")).toBeInTheDocument();
  });

  it("uses the play button spinner as the only buffering indicator", () => {
    const track = createMockTrack({
      title: "Buffering Song",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
      playerState: { isBuffering: true },
    });

    expect(screen.queryByText("Buffering...")).toBeNull();
  });

  it("keeps the mobile dock artwork, info, and controls vertically aligned", () => {
    const track = createMockTrack({
      title: "The Season",
      artist: "Minor Empires",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    const trackButton = screen.getByLabelText("Open fullscreen player");
    const mobileRow = trackButton.parentElement;
    const mobilePlayButton = screen
      .getAllByRole("button", { name: "Play" })
      .find((button) => button.className.includes("h-12"));
    const mobileControls = mobilePlayButton?.parentElement;

    expect(mobilePlayButton).toBeInTheDocument();
    expect(mobileRow).toHaveClass("px-4", "pt-3", "pb-0.5");
    expect(mobileControls).toHaveClass("self-stretch");
    expect(mobileControls).not.toHaveClass("translate-y-1");
  });
});
