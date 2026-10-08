import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const useApi = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const refetchPlaylistOptions = vi.hoisted(() => vi.fn());
const modal = vi.hoisted(() => ({
  props: null as {
    open: boolean;
    onSubmit: (payload: {
      name: string;
      description: string;
      coverDataUrl: string | null;
      visibility: "public" | "private";
      isCollaborative: boolean;
      tracks: unknown[];
    }) => Promise<void>;
  } | null,
}));

vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/hooks/use-api", () => ({ useApi }));
vi.mock("react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/components/playlists/PlaylistCreateModal", () => ({
  PlaylistCreateModal: (props: typeof modal.props) => {
    modal.props = props;
    return null;
  },
}));

import {
  PlaylistComposerProvider,
  usePlaylistComposer,
} from "@/contexts/PlaylistComposerContext";

function wrapper({ children }: { children: ReactNode }) {
  return <PlaylistComposerProvider>{children}</PlaylistComposerProvider>;
}

describe("PlaylistComposerProvider", () => {
  beforeEach(() => {
    api.mockReset();
    navigate.mockReset();
    refetchPlaylistOptions.mockReset();
    modal.props = null;
    useApi.mockImplementation((url: string | null) => ({
      data: url ? [{ id: 7, name: "Favorites" }] : null,
      refetch: refetchPlaylistOptions,
    }));
  });

  it("shares one lazy playlist request and refreshes it after creation", async () => {
    api.mockResolvedValueOnce({ id: 12 });
    const { result } = renderHook(() => usePlaylistComposer(), { wrapper });

    act(() => {
      result.current.ensurePlaylistOptionsLoaded();
    });
    await waitFor(() => {
      expect(result.current.playlistOptions).toEqual([
        { id: 7, name: "Favorites" },
      ]);
    });

    act(() => {
      result.current.openCreatePlaylist();
    });
    await act(async () => {
      await modal.props?.onSubmit({
        name: "New playlist",
        description: "",
        coverDataUrl: null,
        visibility: "private",
        isCollaborative: false,
        tracks: [],
      });
    });

    expect(refetchPlaylistOptions).toHaveBeenCalledOnce();
  });

  it("adds the source tracks after creating a playlist", async () => {
    api.mockResolvedValueOnce({ id: 12 }).mockResolvedValueOnce({});
    const { result } = renderHook(() => usePlaylistComposer(), { wrapper });

    act(() => {
      result.current.openCreatePlaylist({
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

    await act(async () => {
      await modal.props?.onSubmit({
        name: "High Vis favourites",
        description: "",
        coverDataUrl: null,
        visibility: "private",
        isCollaborative: false,
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

    expect(api).toHaveBeenNthCalledWith(1, "/api/playlists", "POST", {
      name: "High Vis favourites",
      description: "",
      cover_data_url: null,
      visibility: "private",
      is_collaborative: false,
    });
    expect(api).toHaveBeenNthCalledWith(2, "/api/playlists/12/tracks", "POST", {
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
