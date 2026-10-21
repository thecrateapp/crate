import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPlayerActions,
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";

import { ExtendedPlayer } from "./ExtendedPlayer";

const useIsDesktopMock = vi.hoisted(() => vi.fn(() => true));
const navigateMock = vi.hoisted(() => vi.fn());
const resolvedArtistMock = vi.hoisted(() => ({
  value: null as {
    id?: number;
    globalArtistUid?: string;
    name: string;
    slug?: string;
  } | null,
}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});
type MockVisualizerConfig = {
  surfaceMode: PlayerSurfaceMode;
  useAlbumPalette: boolean;
  trackVizProfile: { hasAnalysis: boolean; summary: string | null };
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
};

const useVisualizerConfigMock = vi.hoisted(() =>
  vi.fn<() => MockVisualizerConfig>(() => ({
    surfaceMode: "cd",
    useAlbumPalette: false,
    trackVizProfile: { hasAnalysis: false, summary: null },
    setSurfaceMode: vi.fn<(mode: PlayerSurfaceMode) => void>(),
  })),
);

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: useIsDesktopMock,
}));

vi.mock("@/components/player/SpinningDisc", () => ({
  SpinningDisc: () => <div data-testid="spinning-disc" />,
}));

vi.mock("@/components/player/PlayerTrackIdentity", () => ({
  PlayerTrackIdentity: (props: Record<string, unknown>) => (
    <div data-testid="player-track-identity" data-props={JSON.stringify(props)}>
      <button
        aria-label="Open artist"
        disabled={!props.artistClickable}
        onClick={() => (props.onArtistClick as (() => void) | undefined)?.()}
      />
    </div>
  ),
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
    resolvedArtist: resolvedArtistMock.value,
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
  useVisualizerConfig: useVisualizerConfigMock,
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
    delete document.documentElement.dataset.crateLinuxWindowChrome;
    useIsDesktopMock.mockReturnValue(true);
    resolvedArtistMock.value = null;
    navigateMock.mockReset();
  });

  it("hides the visualizer in the Linux desktop player", () => {
    document.documentElement.dataset.crateLinuxWindowChrome = "true";
    const track = createMockTrack({
      id: "extended-linux-visualizer-track",
      entityUid: "extended-linux-visualizer-track",
      title: "Linux visualizer",
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

    expect(screen.queryByRole("tab", { name: /Visualizer/ })).toBeNull();
    expect(screen.queryByLabelText("Visualizer settings")).toBeNull();
  });

  it("enables the artist badge for a global artist identity", () => {
    resolvedArtistMock.value = {
      globalArtistUid: "artist-global-1",
      name: "Crate",
    };
    const track = createMockTrack({
      id: "extended-global-artist-track",
      entityUid: "extended-global-artist-track",
      title: "Global artist track",
      artist: "Crate",
      globalArtistUid: "artist-global-1",
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

    const identity = screen.getByTestId("player-track-identity");
    const props = JSON.parse(identity.dataset.props || "{}");
    expect(props.artistClickable).toBe(true);
  });

  it("navigates to the artist when the artist badge is clicked", async () => {
    resolvedArtistMock.value = {
      id: 42,
      name: "Crate",
      slug: "crate",
    };
    const track = createMockTrack({
      id: "extended-artist-navigation-track",
      entityUid: "extended-artist-navigation-track",
      title: "Artist navigation",
      artist: "Crate",
    });

    const onClose = vi.fn();
    renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={onClose} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Open artist" }));

    expect(navigateMock).toHaveBeenCalledWith("/artists/crate");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps desktop Equalizer access while the effect is off without enabling it", async () => {
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

    expect(
      screen.getByRole("button", { name: "Equalizer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Now playing", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Equalizer" }));
    expect(screen.getByRole("button", { name: "Equalizer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem("listen-eq-enabled")).toBe("false");
  });

  it("uses semantic tokens for the player chrome and tabs", async () => {
    localStorage.setItem("listen-eq-enabled", "true");
    const user = userEvent.setup();
    const track = createMockTrack({
      id: "extended-chrome-track",
      entityUid: "extended-chrome-track",
      title: "Extended chrome",
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

    const closeButton = screen.getByLabelText("Close player");
    const equalizerButton = screen.getByRole("button", {
      name: "Equalizer",
    });
    const visualizerSettingsButton = screen.getByRole("button", {
      name: "Visualizer settings",
    });
    const activeTab = screen.getByRole("tab", { name: "Queue" });
    const inactiveTab = screen.getByRole("tab", { name: "Suggested" });

    for (const button of [
      closeButton,
      equalizerButton,
      visualizerSettingsButton,
    ]) {
      expect(button).toHaveAttribute("data-size", "icon-lg");
      expect(button.className).not.toContain("backdrop-blur");
    }
    expect(visualizerSettingsButton).toBeDisabled();
    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(inactiveTab).toHaveAttribute("aria-selected", "false");
    expect(activeTab).toHaveAttribute(
      "aria-controls",
      screen.getByRole("tabpanel").id,
    );
    await user.click(equalizerButton);
    expect(equalizerButton).toHaveAttribute("aria-pressed", "true");
  });

  it("uses semantic tokens for the artwork surface", () => {
    useVisualizerConfigMock.mockReturnValue({
      surfaceMode: "cover",
      useAlbumPalette: false,
      trackVizProfile: { hasAnalysis: true, summary: "Analyzed" },
      setSurfaceMode: vi.fn(),
    });
    const track = createMockTrack({
      id: "extended-artwork-track",
      entityUid: "extended-artwork-track",
      title: "Extended artwork",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(container.innerHTML).not.toContain("blur-3xl");

    expect(container.innerHTML).toContain("bg-surface-quiet-subtle");
    expect(container.innerHTML).not.toContain("shadow-player-artwork");
    expect(container.innerHTML).toContain("text-text-muted");
    expect(container.innerHTML).not.toContain("bg-primary/10");
    expect(container.innerHTML).not.toContain("border-white/10");
    expect(container.innerHTML).not.toContain("bg-white/[0.02]");
    expect(container.innerHTML).not.toContain("bg-white/5");
    expect(container.innerHTML).not.toContain("text-white/40");
  });

  it("keeps visible cover art without decorative shadow", () => {
    useVisualizerConfigMock.mockReturnValue({
      surfaceMode: "cover",
      useAlbumPalette: false,
      trackVizProfile: { hasAnalysis: false, summary: null },
      setSurfaceMode: vi.fn(),
    });
    const track = createMockTrack({
      id: "extended-visible-artwork-track",
      entityUid: "extended-visible-artwork-track",
      title: "Visible artwork",
      artist: "Crate",
      albumCover: "/cover.jpg",
    });

    const { container } = renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(container.innerHTML).not.toContain("shadow-player-artwork-layered");
  });
});
