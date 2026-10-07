import { describe, expect, it, vi } from "vitest";

import { buildCuratedPlaylistActions } from "@/pages/curated-playlist-actions";

type Input = Parameters<typeof buildCuratedPlaylistActions>[0];

function buildActions(playAll: Input["playAll"]) {
  return buildCuratedPlaylistActions({
    data: {
      id: 15,
      name: "Deftones",
      tracks: [{ id: 101 }, { id: 102 }],
    },
    id: "15",
    offlinePresentation: { busy: false, buttonLabel: "Offline" },
    offlineState: "idle",
    offlineSupported: false,
    openCreatePlaylist: vi.fn(),
    playerTracks: [
      { id: "a", title: "Digital Bath", artist: "Deftones" },
      { id: "b", title: "Change", artist: "Deftones" },
    ],
    playAll,
    refetch: vi.fn(),
    setTogglingFollow: vi.fn(),
    t: ((key: string) => key) as Input["t"],
    togglePlaylistOffline: vi.fn(),
    togglingFollow: false,
  } as unknown as Input);
}

describe("buildCuratedPlaylistActions", () => {
  it("records the playlist id as the play source for every playback entry", () => {
    const playAll = vi.fn();
    const actions = buildActions(playAll);

    actions.handlePlay();
    actions.handlePlayTrack(102);
    actions.handleShuffle();

    expect(playAll).toHaveBeenCalledTimes(3);
    for (const call of playAll.mock.calls) {
      expect(call[2]).toMatchObject({ type: "playlist", id: 15 });
    }
  });
});
