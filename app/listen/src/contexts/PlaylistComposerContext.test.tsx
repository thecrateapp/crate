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
});
