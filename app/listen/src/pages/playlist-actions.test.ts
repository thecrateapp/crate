import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { notify } from "@crate/ui/lib/notify";
import { buildPlaylistActions } from "./playlist-actions";
import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

type Input = Parameters<typeof buildPlaylistActions>[0];
const a = {
  title: "A",
  artist: "Band",
  globalTrackUid: "a",
  playlistEntryId: 101,
  playlistPosition: 1,
};
const b = {
  title: "B",
  artist: "Band",
  globalTrackUid: "b",
  playlistEntryId: 102,
  playlistPosition: 2,
};
const newTrack = { title: "New", artist: "Band", globalTrackUid: "new" };
function row(track: PlaylistComposerTrack, id: number, position: number) {
  return {
    id,
    position,
    global_track_uid: track.globalTrackUid,
    title: track.title,
    artist: track.artist,
  };
}
function setup(original: PlaylistComposerTrack[] = [a, b]) {
  const setEditorOpen = vi.fn();
  const refetch = vi.fn();
  const actions = buildPlaylistActions({
    data: { id: 10, access: "owner", tracks: [] },
    editableTracks: original,
    id: "10",
    offlinePresentation: { busy: false, buttonLabel: "Offline" },
    offlineState: "idle",
    offlineSupported: false,
    openCreatePlaylist: vi.fn(),
    navigate: vi.fn(),
    playerTracks: [],
    playAll: vi.fn(),
    refetch,
    setCopying: vi.fn(),
    setDeleteOpen: vi.fn(),
    setDeleting: vi.fn(),
    setEditorOpen,
    setLeaving: vi.fn(),
    setMembersOpen: vi.fn(),
    setRemovingMemberId: vi.fn(),
    setSaving: vi.fn(),
    setTogglingFollow: vi.fn(),
    t: ((key: string) => key) as Input["t"],
    togglePlaylistOffline: vi.fn(),
    togglingFollow: false,
  } as unknown as Input);
  return { actions, setEditorOpen, refetch };
}
function payload(tracks: PlaylistComposerTrack[]) {
  return {
    name: "Playlist",
    description: "",
    coverDataUrl: null,
    visibility: "private" as const,
    isCollaborative: false,
    tracks,
  };
}

describe("playlist editor persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists a reorder of existing entry IDs before closing the editor", async () => {
    vi.mocked(api).mockResolvedValue({
      tracks: [row(a, 101, 1), row(b, 102, 2)],
    });
    const { actions, setEditorOpen } = setup();
    await actions.handleSavePlaylist(payload([b, a]));
    expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [102, 101],
    });
    expect(setEditorOpen).toHaveBeenCalledWith(false);
    expect(notify.success).toHaveBeenCalledWith("playlist.toasts.updated");
  });

  it("uses the new server entry ID to retain an interleaved added track", async () => {
    vi.mocked(api).mockImplementation(async (_url, method) => {
      if (method === "GET" || method === undefined) {
        const added = vi
          .mocked(api)
          .mock.calls.some(
            ([path, verb]) => path.endsWith("/tracks") && verb === "POST",
          );
        return {
          tracks: [
            row(a, 101, 1),
            row(b, 102, 2),
            ...(added ? [row(newTrack, 103, 3)] : []),
          ],
        };
      }
      return { ok: true, added: 1 };
    });
    const { actions } = setup();
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [102, 103, 101],
    });
  });

  it("retains distinct existing entries of the same track", async () => {
    const duplicate = { ...a, playlistEntryId: 104, playlistPosition: 3 };
    vi.mocked(api).mockResolvedValue({
      tracks: [row(a, 101, 1), row(b, 102, 2), row(duplicate, 104, 3)],
    });
    const { actions } = setup([a, b, duplicate]);
    await actions.handleSavePlaylist(payload([duplicate, b, a]));
    expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [104, 102, 101],
    });
  });

  it("keeps the editor open and does not announce success when reorder fails", async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (url.endsWith("/reorder")) throw new Error("Unavailable");
      return { tracks: [row(a, 101, 1), row(b, 102, 2)] };
    });
    const { actions, setEditorOpen, refetch } = setup();
    await actions.handleSavePlaylist(payload([b, a]));
    expect(notify.error).toHaveBeenCalledWith("playlist.toasts.updateFailed");
    expect(notify.success).not.toHaveBeenCalled();
    expect(setEditorOpen).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does not append a new track again when retrying a failed reorder", async () => {
    let added = false;
    let failed = false;
    vi.mocked(api).mockImplementation(async (url, method) => {
      if (url.endsWith("/tracks") && method === "POST") {
        added = true;
        return { added: 1 };
      }
      if (url.endsWith("/reorder") && !failed) {
        failed = true;
        throw new Error("Unavailable");
      }
      return {
        tracks: [
          row(a, 101, 1),
          row(b, 102, 2),
          ...(added ? [row(newTrack, 103, 3)] : []),
        ],
      };
    });
    const { actions } = setup();
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          ([url, method]) => url.endsWith("/tracks") && method === "POST",
        ),
    ).toHaveLength(1);
    expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [102, 103, 101],
    });
    expect(notify.success).toHaveBeenCalledTimes(1);
  });

  it("does not delete a collaborator's concurrent addition", async () => {
    vi.mocked(api).mockResolvedValue({
      tracks: [row(a, 101, 1), row(b, 102, 2), row(newTrack, 103, 3)],
    });
    const { actions, setEditorOpen } = setup();
    await actions.handleSavePlaylist(payload([b, a]));
    expect(
      vi.mocked(api).mock.calls.some(([, method]) => method === "DELETE"),
    ).toBe(false);
    expect(
      vi.mocked(api).mock.calls.some(([url]) => url.endsWith("/reorder")),
    ).toBe(false);
    expect(setEditorOpen).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("playlist.toasts.updateFailed");
  });

  it("removes entries by descending current positions before applying the final order", async () => {
    const c = { ...newTrack, playlistEntryId: 103, playlistPosition: 3 };
    vi.mocked(api).mockResolvedValue({
      tracks: [row(a, 101, 3), row(b, 102, 1), row(c, 103, 2)],
    });
    const { actions } = setup([a, b, c]);
    await actions.handleSavePlaylist(payload([b]));
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([, method]) => method === "DELETE")
        .map(([url]) => url),
    ).toEqual(["/api/playlists/10/tracks/3", "/api/playlists/10/tracks/2"]);
    expect(api).toHaveBeenCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [102],
    });
  });

  it("does not claim success when the server could not resolve an added track", async () => {
    vi.mocked(api).mockResolvedValue({
      tracks: [row(a, 101, 1), row(b, 102, 2)],
      added: 0,
    });
    const { actions, setEditorOpen } = setup();
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    expect(
      vi.mocked(api).mock.calls.some(([url]) => url.endsWith("/reorder")),
    ).toBe(false);
    expect(setEditorOpen).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("playlist.toasts.updateFailed");
  });

  it.each([
    [
      [a, b],
      [101, 102],
    ],
    [
      [b, a],
      [102, 101],
    ],
  ] as const)(
    "removes its own partial addition before saving the revised draft %j",
    async (revised, orderedIds) => {
      let entries = [row(a, 101, 1), row(b, 102, 2)];
      let failReorder = true;
      vi.mocked(api).mockImplementation(async (url, method, body) => {
        if (url.endsWith("/tracks") && method === "POST") {
          entries.push(row(newTrack, 103, 3));
          return { added: 1 };
        }
        if (method === "DELETE") {
          const position = Number(url.split("/").pop());
          entries = entries.filter((entry) => entry.position !== position);
        }
        if (url.endsWith("/reorder")) {
          if (failReorder) {
            failReorder = false;
            throw new Error("Reorder unavailable");
          }
          const ids = (body as { track_ids: number[] }).track_ids;
          entries = ids.map((id, index) => ({
            ...entries.find((entry) => entry.id === id)!,
            position: index + 1,
          }));
        }
        return { tracks: [...entries] };
      });
      const { actions } = setup();
      await actions.handleSavePlaylist(payload([b, newTrack, a]));
      expect(notify.success).not.toHaveBeenCalled();
      await actions.handleSavePlaylist(payload([...revised]));
      expect(api).toHaveBeenCalledWith("/api/playlists/10/tracks/3", "DELETE");
      expect(api).toHaveBeenLastCalledWith(
        "/api/playlists/10/reorder",
        "POST",
        { track_ids: orderedIds },
      );
      expect(entries.map((entry) => entry.id)).toEqual(orderedIds);
      expect(notify.success).toHaveBeenCalledTimes(1);
    },
  );

  it("removes its own abandoned addition while preserving a collaborator's later entry", async () => {
    const concurrent = { ...newTrack, globalTrackUid: "collaborator" };
    let entries = [row(a, 101, 1), row(b, 102, 2)];
    vi.mocked(api).mockImplementation(async (url, method) => {
      if (url.endsWith("/tracks") && method === "POST") {
        entries.push(row(newTrack, 103, 3));
        return { added: 1 };
      }
      if (url.endsWith("/reorder")) throw new Error("Reorder unavailable");
      if (method === "DELETE")
        entries = entries.filter(
          (entry) => entry.position !== Number(url.split("/").pop()),
        );
      return { tracks: [...entries] };
    });
    const { actions, setEditorOpen } = setup();
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    entries.push(row(concurrent, 104, 4));
    await actions.handleSavePlaylist(payload([b, a]));
    expect(entries.map((entry) => entry.id)).toEqual([101, 102, 104]);
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([, method]) => method === "DELETE")
        .map(([url]) => url),
    ).toEqual(["/api/playlists/10/tracks/3"]);
    expect(notify.success).not.toHaveBeenCalled();
    expect(setEditorOpen).not.toHaveBeenCalled();
  });

  it("reconciles the original order after a failed response even without newly added entries", async () => {
    let entries = [row(a, 101, 1), row(b, 102, 2)];
    let fail = true;
    vi.mocked(api).mockImplementation(async (url, _method, body) => {
      if (url.endsWith("/reorder")) {
        const ids = (body as { track_ids: number[] }).track_ids;
        entries = ids.map((id, index) => ({
          ...entries.find((entry) => entry.id === id)!,
          position: index + 1,
        }));
        if (fail) {
          fail = false;
          throw new Error("Response lost after commit");
        }
      }
      return { tracks: [...entries] };
    });
    const { actions } = setup();
    await actions.handleSavePlaylist(payload([b, a]));
    await actions.handleSavePlaylist(payload([a, b]));
    expect(entries.map((entry) => entry.id)).toEqual([101, 102]);
    expect(api).toHaveBeenLastCalledWith("/api/playlists/10/reorder", "POST", {
      track_ids: [101, 102],
    });
  });

  it("recovers ownership when the read after its successful addition failed", async () => {
    let entries = [row(a, 101, 1), row(b, 102, 2)];
    let failRead = false;
    vi.mocked(api).mockImplementation(async (url, method) => {
      if (url.endsWith("/tracks") && method === "POST") {
        entries.push(row(newTrack, 103, 3));
        failRead = true;
        return { added: 1 };
      }
      if (method == null && failRead) {
        failRead = false;
        throw new Error("Read unavailable");
      }
      if (method === "DELETE")
        entries = entries.filter(
          (entry) => entry.position !== Number(url.split("/").pop()),
        );
      return { tracks: [...entries] };
    });
    const { actions } = setup();
    await actions.handleSavePlaylist(payload([b, newTrack, a]));
    await actions.handleSavePlaylist(payload([a, b]));
    expect(entries.map((entry) => entry.id)).toEqual([101, 102]);
    expect(api).toHaveBeenCalledWith("/api/playlists/10/tracks/3", "DELETE");
    expect(notify.success).toHaveBeenCalledOnce();
  });
});
