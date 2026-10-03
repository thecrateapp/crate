import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { PlayerActionsContext } from "@/contexts/player-context";
import { useAlbumPlaybackActions } from "@/pages/use-album-playback-actions";
import { createMockPlayerActions } from "@/test/render-with-listen-providers";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe("useAlbumPlaybackActions", () => {
  it("does not queue or confirm play-next for an album without playable tracks", () => {
    const playerActions = createMockPlayerActions();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerActionsContext.Provider value={playerActions}>
        {children}
      </PlayerActionsContext.Provider>
    );
    const { result } = renderHook(
      () =>
        useAlbumPlaybackActions({
          albumHref: "/albums/1",
          albumRadioSeed: null,
          artistName: "High Vis",
          clearTrackSelection: vi.fn(),
          closeAlbumMenu: vi.fn(),
          displayName: "Guided Tour",
          isPreRelease: true,
          playableAlbumTracks: [],
          playerTracks: [],
          setSelectionPlaylistPickerOpen: vi.fn(),
          t: (key: string) => key,
        }),
      { wrapper },
    );

    result.current.handlePlayNextAlbum();

    expect(playerActions.playNext).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
