import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openCreatePlaylist = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const playlists = vi.hoisted(() => ({
  value: [] as Array<{ id: number; name: string }>,
}));

vi.mock("@/contexts/PlaylistComposerContext", () => ({
  useOptionalPlaylistComposer: () => ({ openCreatePlaylist }),
}));

vi.mock("@/lib/api", () => ({ api }));

vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string | null) => ({
    data: url === "/api/playlists" ? playlists.value : null,
  }),
}));

import { I18nProvider } from "@/i18n";
import { useTrackPlaylistActions } from "@/hooks/use-track-playlist-actions";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="es">{children}</I18nProvider>;
}

const track = {
  id: 12,
  entity_uid: "track-entity-12",
  global_track_uid: "global-track-12",
  title: "Talk For Hours",
  artist: "High Vis",
  album: "Blending",
  duration: 299,
  path: "/music/high-vis/talk-for-hours.flac",
};

describe("useTrackPlaylistActions", () => {
  beforeEach(() => {
    openCreatePlaylist.mockReset();
    api.mockClear();
    playlists.value = [];
  });

  it("opens a new playlist composer with the selected track", () => {
    const { result } = renderHook(() => useTrackPlaylistActions(), { wrapper });

    act(() => {
      result.current.onCreatePlaylist(track);
    });

    expect(openCreatePlaylist).toHaveBeenCalledWith({
      tracks: [
        {
          entityUid: "track-entity-12",
          globalTrackUid: "global-track-12",
          libraryTrackId: 12,
          path: "/music/high-vis/talk-for-hours.flac",
          title: "Talk For Hours",
          artist: "High Vis",
          album: "Blending",
          duration: 299,
        },
      ],
    });
  });

  it("adds the selected track to an existing playlist", async () => {
    const { result } = renderHook(() => useTrackPlaylistActions(), { wrapper });

    await act(async () => {
      await result.current.onAddToPlaylist(7, track);
    });

    expect(api).toHaveBeenCalledWith("/api/playlists/7/tracks", "POST", {
      tracks: [
        {
          track_id: 12,
          global_track_uid: "global-track-12",
          entity_uid: "track-entity-12",
          path: "/music/high-vis/talk-for-hours.flac",
          title: "Talk For Hours",
          artist: "High Vis",
          album: "Blending",
          duration: 299,
        },
      ],
    });
  });
});
