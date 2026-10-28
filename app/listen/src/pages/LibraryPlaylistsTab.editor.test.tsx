import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { api } from "@/lib/api";
import { notify } from "@crate/ui/lib/notify";
import { LibraryPlaylistsTab } from "./LibraryPlaylistsTab";
import type { PlaylistCreateModal } from "@/components/playlists/PlaylistCreateModal";
import type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";

const draft = vi.hoisted(() => ({
  tracks: null as PlaylistComposerTrack[] | null,
}));

const playlist = {
  id: 10,
  user_id: 1,
  name: "Original",
  description: "",
  track_count: 2,
  total_duration: 0,
  is_smart: false,
  created_at: "2026-10-24",
};
const entries = [
  {
    id: 101,
    position: 1,
    title: "First",
    artist: "Band",
    album: "Record",
    duration: 180,
    global_track_uid: "first",
  },
  {
    id: 102,
    position: 2,
    title: "Second",
    artist: "Band",
    album: "Record",
    duration: 180,
    global_track_uid: "second",
  },
];
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: { playlists: [playlist], followed_curated_playlists: [] },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({ openCreatePlaylist: vi.fn() }),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/playlists/PlaylistCard", () => ({
  PlaylistCard: ({
    extraActions,
  }: {
    extraActions: Array<{ key: string; onClick: () => void }>;
  }) => (
    <button
      onClick={() =>
        extraActions.find((action) => action.key === "edit")?.onClick()
      }
    >
      Edit Original
    </button>
  ),
}));
vi.mock("@/components/playlists/PlaylistCreateModal", () => ({
  PlaylistCreateModal: (props: Parameters<typeof PlaylistCreateModal>[0]) =>
    props.open ? (
      <section>
        <h2>Playlist editor</h2>
        <button
          onClick={() =>
            void props.onSubmit({
              name: "Edited",
              description: "",
              coverDataUrl: null,
              visibility: "private",
              isCollaborative: false,
              tracks: draft.tracks ?? [...props.initialTracks].reverse(),
            })
          }
        >
          Save changes
        </button>
      </section>
    ) : null,
}));

describe("Collection playlist editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draft.tracks = null;
  });
  it("persists the editor order through the shared reconciliation before closing", async () => {
    vi.mocked(api).mockResolvedValue({ ...playlist, tracks: entries });
    renderWithListenProviders(<LibraryPlaylistsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Original" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
        track_ids: [102, 101],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Playlist editor" }),
      ).not.toBeInTheDocument(),
    );
    expect(notify.success).toHaveBeenCalledWith("Playlist updated");
  });
  it("keeps the collection editor and draft when the reorder request fails", async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (url.endsWith("/reorder")) throw new Error("Unavailable");
      return { ...playlist, tracks: entries };
    });
    renderWithListenProviders(<LibraryPlaylistsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Original" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("Failed to update playlist"),
    );
    expect(
      screen.getByRole("heading", { name: "Playlist editor" }),
    ).toBeInTheDocument();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it("keeps ownership of partial additions across parent rerenders and a revised draft", async () => {
    let current = [...entries];
    let fail = true;
    vi.mocked(api).mockImplementation(async (url, method) => {
      if (url.endsWith("/tracks") && method === "POST") {
        current.push({
          ...entries[0]!,
          id: 103,
          position: 3,
          global_track_uid: "added",
          title: "Added",
        });
        return { added: 1 };
      }
      if (method === "DELETE")
        current = current.filter(
          (entry) => entry.position !== Number(url.split("/").pop()),
        );
      if (url.endsWith("/reorder") && fail) {
        fail = false;
        throw new Error("Unavailable");
      }
      return { ...playlist, tracks: [...current] };
    });
    const originals = entries.map((entry) => ({
      title: entry.title,
      artist: entry.artist,
      globalTrackUid: entry.global_track_uid,
      playlistEntryId: entry.id,
      playlistPosition: entry.position,
    }));
    draft.tracks = [
      originals[1]!,
      { title: "Added", artist: "Band", globalTrackUid: "added" },
      originals[0]!,
    ];
    renderWithListenProviders(<LibraryPlaylistsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Original" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    draft.tracks = originals;
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledOnce());
    expect(current.map((entry) => entry.id)).toEqual([101, 102]);
    expect(api).toHaveBeenLastCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [101, 102],
    });
  });
});
