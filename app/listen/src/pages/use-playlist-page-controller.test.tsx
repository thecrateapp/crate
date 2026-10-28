import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { usePlaylistPageController } from "./use-playlist-page-controller";
import { api } from "@/lib/api";
import type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";

const state = vi.hoisted(() => ({
  data: null as unknown,
  draft: [] as PlaylistComposerTrack[],
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: state.data,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({
    openCreatePlaylist: vi.fn(),
    playlistOptions: [],
    ensurePlaylistOptionsLoaded: vi.fn(),
  }),
}));
function ControllerView() {
  const [, setVersion] = useState(0);
  const page = usePlaylistPageController();
  return (
    <>
      <button onClick={() => setVersion((value) => value + 1)}>
        Refresh view
      </button>
      <button onClick={() => page.setEditorOpen(!page.editorOpen)}>
        {page.editorOpen ? "Close editor" : "Open editor"}
      </button>
      <button
        onClick={() =>
          void page.handleSavePlaylist({
            name: "Draft",
            description: "",
            coverDataUrl: null,
            visibility: "private",
            isCollaborative: false,
            tracks: state.draft,
          })
        }
      >
        Save draft
      </button>
      {page.saving ? <span>Saving</span> : null}
      <output>
        {page.editableTracks.map((track) => track.playlistEntryId).join(",")}
      </output>
    </>
  );
}
const track = {
  id: 101,
  position: 1,
  title: "Original",
  artist: "Band",
  album: "Record",
  track_path: "original.flac",
  global_track_uid: "track-a",
  duration: 180,
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  state.data = { id: 10, name: "Original", tracks: [track] };
});

it("retains the track edit session while save state recreates its actions", async () => {
  const second = {
    ...track,
    id: 102,
    position: 2,
    global_track_uid: "track-b",
  };
  let current = [track, second];
  let fail = true;
  state.data = { id: 10, name: "Original", tracks: current };
  const originals = current.map((entry) => ({
    title: entry.title,
    artist: entry.artist,
    globalTrackUid: entry.global_track_uid,
    playlistEntryId: entry.id,
    playlistPosition: entry.position,
  }));
  vi.mocked(api).mockImplementation(async (url, method) => {
    if (url.endsWith("/tracks") && method === "POST") {
      current.push({
        ...track,
        id: 103,
        position: 3,
        global_track_uid: "added",
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
    return { tracks: [...current] };
  });
  renderWithListenProviders(<ControllerView />, {
    route: "/playlist/10",
    path: "/playlist/:id",
  });
  fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
  state.draft = [
    originals[1]!,
    { title: "Added", artist: "Band", globalTrackUid: "added" },
    originals[0]!,
  ];
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.filter(([url]) => url.endsWith("/reorder")),
    ).toHaveLength(1),
  );
  await waitFor(() =>
    expect(screen.queryByText("Saving")).not.toBeInTheDocument(),
  );
  state.draft = originals;
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Open editor" }),
    ).toBeInTheDocument(),
  );
  expect(current.map((entry) => entry.id)).toEqual([101, 102]);
  expect(api).toHaveBeenLastCalledWith("/api/playlists/10/reorder", "POST", {
    track_ids: [101, 102],
  });
});
it("freezes the editing baseline until close, then uses refreshed tracks for the next edit", () => {
  renderWithListenProviders(<ControllerView />, {
    route: "/playlist/10",
    path: "/playlist/:id",
  });
  fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
  state.data = {
    id: 10,
    name: "Refreshed",
    tracks: [
      track,
      { ...track, id: 102, global_track_uid: "track-b", position: 2 },
    ],
  };
  fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
  expect(screen.getByRole("status")).toHaveTextContent(/^101$/);
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
  expect(screen.getByRole("status")).toHaveTextContent("101,102");
});
