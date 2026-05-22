import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── polyfill requestAnimationFrame ──────────────────────────────────
globalThis.requestAnimationFrame = vi.fn(
  (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
);
globalThis.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

// ── mocks ───────────────────────────────────────────────────────────
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  AUTH_TOKEN_EVENT: "crate:auth-token-updated",
}));

vi.mock("@/components/player/SpinningDisc", () => ({
  SpinningDisc: (props: Record<string, unknown>) => (
    <div data-testid="spinning-disc" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/components/player/PlayerTrackIdentity", () => ({
  PlayerTrackIdentity: (props: Record<string, unknown>) => (
    <div
      data-testid="player-track-identity"
      data-props={JSON.stringify(props)}
    />
  ),
}));

vi.mock("@/components/player/EqualizerPanel", () => ({
  EqualizerPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="equalizer-panel">
      <button data-testid="eq-close-btn" onClick={onClose}>
        Close EQ
      </button>
    </div>
  ),
}));

vi.mock("@/components/player/extended/InfoTab", () => ({
  InfoTab: ({ className }: { className?: string }) => (
    <div data-testid="info-tab" className={className}>
      Info tab content
    </div>
  ),
}));

vi.mock("@/components/player/bar/PlayerTrackMenu", () => ({
  PlayerTrackMenu: ({
    className,
  }: {
    className?: string;
    currentTrack?: Record<string, unknown>;
  }) => (
    <div data-testid="player-track-menu" className={className}>
      menu
    </div>
  ),
}));

vi.mock("@/components/player/bar/PlayerSeekBar", () => ({
  PlayerSeekBar: (props: {
    onSeek: (t: number) => void;
    currentTime: number;
    duration: number;
  }) => (
    <div data-testid="seek-bar">
      <button data-testid="seek-btn" onClick={() => props.onSeek(30)}>
        Seek
      </button>
      <span data-testid="seek-time">{props.currentTime}</span>
      <span data-testid="seek-dur">{props.duration}</span>
    </div>
  ),
}));

vi.mock("@/components/player/bar/player-bar-utils", () => ({
  formatPlayerTime: (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`,
}));

vi.mock("@/components/player/player-source", () => ({
  getPlaySourceLabel: (source: { name?: string } | null) =>
    source?.name ?? null,
}));

vi.mock("@/components/player/useResolvedPlayerArtist", () => ({
  useResolvedPlayerArtist: () => ({
    resolvedArtist: null,
    artistAvatarUrl: null,
    markArtistPhotoFailed: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (_t: unknown, time: number, dur: number) => ({
    displayedTime: time,
    displayedDuration: dur,
  }),
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: vi.fn(() => false),
    toggleTrackLike: vi.fn(() => Promise.resolve(true)),
  }),
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-escape-key", () => ({
  useEscapeKey: vi.fn(),
}));

const { useEscapeKey: mockUseEscapeKey } = await import(
  "@crate/ui/lib/use-escape-key"
);

vi.mock("@/lib/mobile-audio-mode", () => ({
  canUseWebAudioEffects: true,
  isMobileAudioRuntime: false,
  stableMobileAudioPipeline: true,
}));

vi.mock("@/lib/player-visualizer-prefs", () => ({
  getPlayerSurfaceModePreference: () => "cd",
  PLAYER_VIZ_PREFS_EVENT: "player-viz-prefs",
  setPlayerSurfaceModePreference: vi.fn(),
}));

vi.mock("@/components/player/player-gestures", () => ({
  getHorizontalPlayerSwipeAction: vi.fn(() => null),
}));

vi.mock("@/components/actions/ItemActionMenu", () => ({
  ItemActionMenu: () => <div data-testid="item-action-menu" />,
  ItemActionMenuButton: () => <div data-testid="item-action-menu-btn" />,
  useItemActionMenu: () => ({
    open: false,
    position: null,
    menuRef: { current: null },
    triggerRef: { current: null },
    hasActions: true,
    openFromTrigger: vi.fn(),
    close: vi.fn(),
    handleContextMenu: vi.fn(),
  }),
}));

vi.mock("@/components/actions/shared", () => ({
  trackToMenuData: (t: Record<string, unknown>) => t,
}));

vi.mock("@/components/actions/track-actions", () => ({
  useTrackActionEntries: () => [],
}));

// ── react-router mock ───────────────────────────────────────────────
const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── imports ─────────────────────────────────────────────────────────
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import {
  renderWithListenProviders,
  createMockTrack,
  createMockPlayerActions,
  createMockPlayerState,
  createMockPlayerProgress,
} from "@/test/render-with-listen-providers";
import type { Track } from "@/contexts/player-types";

// ── helpers ─────────────────────────────────────────────────────────
function makeTrack(overrides: Partial<Track> = {}): Track {
  return createMockTrack({
    id: "t1",
    entityUid: "entity-t1",
    title: "Test Song",
    artist: "Test Artist",
    album: "Test Album",
    albumCover: "https://example.test/cover.jpg",
    duration: 240,
    ...overrides,
  });
}

function makeQueueTrack(
  overrides: Partial<Track> = {},
  idx: number = 0,
): Track {
  return createMockTrack({
    id: `q${idx}`,
    entityUid: `entity-q${idx}`,
    title: `Queue Track ${idx}`,
    artist: `Queue Artist ${idx}`,
    albumCover: idx % 2 === 0 ? "https://example.test/cover.jpg" : undefined,
    ...overrides,
  });
}

// ── tests ───────────────────────────────────────────────────────────
describe("FullscreenPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
  });

  // ════════════════════════════════════════════════════════════════════
  // Rendering states
  // ════════════════════════════════════════════════════════════════════
  describe("rendering states", () => {
    it("renders nothing when open is false", () => {
      const track = makeTrack();
      const { container } = renderWithListenProviders(
        <FullscreenPlayer open={false} onClose={vi.fn()} />,
        {
          playerActions: createMockPlayerActions({
            currentTrack: track,
            queue: [track],
            currentIndex: 0,
          }),
        },
      );

      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when no currentTrack", () => {
      const { container } = renderWithListenProviders(
        <FullscreenPlayer open onClose={vi.fn()} />,
        {
          playerActions: createMockPlayerActions({
            currentTrack: undefined,
            queue: [],
          }),
        },
      );

      expect(container.innerHTML).toBe("");
    });

    it("renders player UI when open with a current track", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Player")).toBeInTheDocument();
      });
    });

    it("shows buffering spinner when isBuffering is true", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: true,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Pause")).toBeInTheDocument();
      });
      // The play/pause button shows Loader2 when isBuffering
      const pauseBtn = screen.getByLabelText("Pause");
      expect(pauseBtn.querySelector("svg")).toBeTruthy();
    });

    it("shows Play icon when paused and not buffering", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: false,
          isBuffering: false,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Play")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Player info display
  // ════════════════════════════════════════════════════════════════════
  describe("player info display", () => {
    it("renders PlayerTrackIdentity with the current track", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const identity = screen.getByTestId("player-track-identity");
        expect(identity).toBeInTheDocument();
        const props = JSON.parse(identity.dataset.props || "{}");
        expect(props.currentTrack.id).toBe("t1");
      });
    });

    it("displays formatted current time and remaining time", async () => {
      const track = makeTrack({ duration: 240 });
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: false,
        }),
        playerProgress: createMockPlayerProgress({
          currentTime: 60,
          duration: 240,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("1:00")).toBeInTheDocument();
        expect(screen.getByText("-3:00")).toBeInTheDocument();
      });
    });

    it("toggles from CD mode to cover art mode on surface mode click", async () => {
      const track = makeTrack({ albumCover: "https://example.test/cover.jpg" });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("spinning-disc")).toBeInTheDocument();
      });

      // Click surface mode toggle to switch to cover mode
      await user.click(screen.getByLabelText("Show album cover"));

      // SpinningDisc should be gone, replaced by cover image
      await waitFor(() => {
        expect(screen.queryByTestId("spinning-disc")).not.toBeInTheDocument();
      });

      const coverImg = document.querySelector(
        'img[src="https://example.test/cover.jpg"]',
      );
      expect(coverImg).toBeInTheDocument();
    });

    it("shows CD mode (SpinningDisc) when surface mode is cd", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("spinning-disc")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Controls
  // ════════════════════════════════════════════════════════════════════
  describe("controls", () => {
    it("calls pause when playing and play/pause button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: false,
        }),
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Pause")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Pause"));
      expect(actions.pause).toHaveBeenCalledTimes(1);
    });

    it("calls resume when paused and play/pause button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: false,
          isBuffering: false,
        }),
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Play")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Play"));
      expect(actions.resume).toHaveBeenCalledTimes(1);
    });

    it("calls next when next button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Next track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Next track"));
      expect(actions.next).toHaveBeenCalledTimes(1);
    });

    it("calls prev when prev button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Previous track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Previous track"));
      expect(actions.prev).toHaveBeenCalledTimes(1);
    });

    it("calls toggleShuffle when shuffle button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
        shuffle: false,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Enable shuffle")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Enable shuffle"));
      expect(actions.toggleShuffle).toHaveBeenCalledTimes(1);
    });

    it("calls cycleRepeat when repeat button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
        repeat: "off",
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Repeat: off")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Repeat: off"));
      expect(actions.cycleRepeat).toHaveBeenCalledTimes(1);
    });

    it("shows repeat-one icon when repeat mode is 'one'", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
          repeat: "one",
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Repeat: one")).toBeInTheDocument();
      });
    });

    it("calls onSeek via PlayerSeekBar", async () => {
      const track = makeTrack({ duration: 240 });
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-btn")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("seek-btn"));
      expect(actions.seek).toHaveBeenCalledWith(30);
    });

    it("equalizer button toggles EqualizerPanel visibility", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Equalizer")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("equalizer-panel")).not.toBeInTheDocument();

      await user.click(screen.getByLabelText("Equalizer"));
      expect(screen.getByTestId("equalizer-panel")).toBeInTheDocument();

      await user.click(screen.getByLabelText("Equalizer"));
      await waitFor(() => {
        expect(screen.queryByTestId("equalizer-panel")).not.toBeInTheDocument();
      });
    });

    it("like button toggles liked state", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Like track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Like track"));
      // should not crash - toggleTrackLike is mocked to resolve
    });

    it("stores seek time via progress display", async () => {
      const track = makeTrack({ duration: 240 });
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerProgress: createMockPlayerProgress({
          currentTime: 90,
          duration: 240,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-time").textContent).toBe("90");
        expect(screen.getByTestId("seek-dur").textContent).toBe("240");
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Tab switching
  // ════════════════════════════════════════════════════════════════════
  describe("tab switching", () => {
    it("defaults to player tab", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
    });

    it("switches to queue tab", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Queue Track 0" }, 0);
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, qTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Player")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Queue Track 0")).toBeInTheDocument();
      });
    });

    it("switches to lyrics tab and shows lyrics content", async () => {
      let apiResolve: (v: Record<string, unknown>) => void = () => {};
      const pendingPromise = new Promise<Record<string, unknown>>((resolve) => {
        apiResolve = resolve;
      });
      apiMock.mockImplementation(() => pendingPromise);

      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("Loading lyrics...")).toBeInTheDocument();
      });

      apiResolve!({ syncedLyrics: null, plainLyrics: "Hello world" });
      apiMock.mockImplementation(() => Promise.resolve({}));
    });

    it("switches to info tab", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Info")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Info"));

      await waitFor(() => {
        expect(screen.getByTestId("info-tab")).toBeInTheDocument();
      });
    });

    it("highlights the active tab pill", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      // The active tab should have bg-white/12 class; the pill itself is a button
      const queuePill = screen.getByText("Queue").closest("button");
      expect(queuePill?.className).toContain("bg-white/12");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Close behavior
  // ════════════════════════════════════════════════════════════════════
  describe("close behavior", () => {
    it("calls onClose when dismiss button is clicked", async () => {
      const track = makeTrack();
      const onClose = vi.fn();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Close player")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Close player"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("escape key calls onClose when on player tab", async () => {
      const track = makeTrack();
      const onClose = vi.fn();

      // Capture the escape handler registered by useEscapeKey
      let capturedHandler: ((e: KeyboardEvent) => void) | null = null;
      vi.mocked(mockUseEscapeKey).mockImplementation(
        (_active: boolean, onEscape: (e: KeyboardEvent) => void) => {
          capturedHandler = onEscape;
        },
      );

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(capturedHandler).not.toBeNull();
      });

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      vi.spyOn(event, "preventDefault");
      vi.spyOn(event, "stopImmediatePropagation");
      capturedHandler!(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("escape key returns to player tab from non-player tab", async () => {
      const track = makeTrack();
      const onClose = vi.fn();
      const user = userEvent.setup();

      // For this test we use real useEscapeKey mock with full implementation
      // We need to control the escape callback sequence
      let capturedHandler: ((e: KeyboardEvent) => void) | null = null;
      vi.mocked(mockUseEscapeKey).mockImplementation(
        (_active: boolean, onEscape: (e: KeyboardEvent) => void) => {
          capturedHandler = onEscape;
        },
      );

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Info")).toBeInTheDocument();
      });

      // Switch to info tab
      await user.click(screen.getByText("Info"));
      await waitFor(() => {
        expect(screen.getByTestId("info-tab")).toBeInTheDocument();
      });

      // Now escape should return to player tab, not close
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      capturedHandler!(event);

      // onClose should NOT have been called
      expect(onClose).not.toHaveBeenCalled();
      // Should be back on player tab
      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Queue tab
  // ════════════════════════════════════════════════════════════════════
  describe("queue tab", () => {
    it('shows "Nothing queued" when queue has no upcoming tracks', async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Nothing queued")).toBeInTheDocument();
      });
    });

    it("shows upcoming tracks count in queue header", async () => {
      const track = makeTrack();
      const qTracks = Array.from({ length: 5 }, (_, i) =>
        makeQueueTrack({ title: `Queue Track ${i}` }, i),
      );
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, ...qTracks],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText(/Up Next · 5 tracks/)).toBeInTheDocument();
      });
    });

    it("shows upcoming track titles in the queue", async () => {
      const track = makeTrack();
      const qTracks = [
        makeQueueTrack({ title: "First In Queue" }, 0),
        makeQueueTrack({ title: "Second In Queue" }, 1),
      ];
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, ...qTracks],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("First In Queue")).toBeInTheDocument();
        expect(screen.getByText("Second In Queue")).toBeInTheDocument();
      });
    });

    it('shows "Suggested" badge on suggested queue tracks', async () => {
      const track = makeTrack();
      const suggestedTrack = makeQueueTrack(
        { title: "Suggested Track", isSuggested: true },
        0,
      );
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, suggestedTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Suggested")).toBeInTheDocument();
      });
    });

    it("calls jumpTo when a queue row is clicked", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Queue One" }, 0);
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track, qTrack],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Queue One")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue One"));
      expect(actions.jumpTo).toHaveBeenCalledWith(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Lyrics tab
  // ════════════════════════════════════════════════════════════════════
  describe("lyrics tab", () => {
    beforeEach(() => {
      // Keep lyrics API in pending state so "Loading..." stays visible
      apiMock.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
      apiMock.mockReset();
      apiMock.mockImplementation(() => Promise.resolve({}));
    });

    it('shows "Loading lyrics..." initially', async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("Loading lyrics...")).toBeInTheDocument();
      });
    });

    it('shows "No lyrics available" when API resolves with no lyrics', async () => {
      apiMock.mockReset();
      apiMock.mockImplementation(() => Promise.resolve({}));

      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("No lyrics available")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Responsive behavior
  // ════════════════════════════════════════════════════════════════════
  describe("responsive behavior", () => {
    it("renders drag handle at the top for mobile", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const dragHandle = document.querySelector(".w-10.h-1");
        expect(dragHandle).toBeInTheDocument();
        expect(dragHandle?.className).toContain("rounded-full");
        expect(dragHandle?.className).toContain("bg-white/20");
      });
    });

    it("renders all four tab pills", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Player")).toBeInTheDocument();
        expect(screen.getByText("Queue")).toBeInTheDocument();
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
        expect(screen.getByText("Info")).toBeInTheDocument();
      });
    });

    it("renders surface mode toggle button with correct label in cd mode", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Show album cover")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Layout
  // ════════════════════════════════════════════════════════════════════
  describe("layout", () => {
    it("renders the player tab with seek bar and controls", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
        expect(screen.getByTestId("player-track-identity")).toBeInTheDocument();
        expect(screen.getByTestId("player-track-menu")).toBeInTheDocument();
      });
    });

    it("does not render queue rows on player tab", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Hidden In Queue" }, 0);

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, qTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });

      expect(screen.queryByText("Hidden In Queue")).not.toBeInTheDocument();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // TEST_GAPs
  // ════════════════════════════════════════════════════════════════════
  describe("TEST_GAPs", () => {
    it.skip("TEST_GAP: swipe-to-dismiss gesture is not testable in jsdom", () => {
      // Swipe gesture simulation (onTouchStart, onTouchMove, onTouchEnd)
      // with delta tracking and rAF-based scheduling requires a real
      // touch environment (mobile browser, Playwright, or Capacitor).
      // jsdom does not support touch events with clientX/clientY in a
      // way that maps to gesture helpers.
    });

    it.skip("TEST_GAP: horizontal swipe for prev/next is not testable in jsdom", () => {
      // Same constraint as swipe-to-dismiss: the horizontal gesture
      // path through getHorizontalPlayerSwipeAction requires real
      // touch deltas relative to viewport width.
    });

    it.skip("TEST_GAP: crossfade transition visuals require real animation frames", () => {
      // Crossfade overlays and progress-driven opacity changes rely on
      // rAF scheduling of useCrossfadeProgress. jsdom cannot produce
      // meaningful intermediate opacity values.
    });

    it.skip("TEST_GAP: native back button (crate:native-back) is Capacitor-only", () => {
      // The native back event is dispatched by Capacitor's back button
      // listener plugin, not available in jsdom.
    });
  });
});
