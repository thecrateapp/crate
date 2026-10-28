import { useState } from "react";
import { Link, Route, Routes } from "react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@crate/ui/shadcn/button";
import { Login } from "./Login";
import { Album } from "./Album";
import { LibraryAlbumsTab } from "./LibraryAlbumsTab";
import { OfflineAccessRoute } from "@/app-shell/OfflineAccessRoute";
import { QueuePanel } from "@/components/player/QueuePanel";
import { PlayerProgressLeaf } from "@/components/player/bar/PlayerProgressLeaf";
import { SavedAlbumsProvider } from "@/contexts/SavedAlbumsContext";
import { AuthContext } from "@/contexts/auth-context";
import { OfflineContext } from "@/contexts/offline-context";
import {
  PlayerActionsContext,
  PlayerStateContext,
  PlayerProgressContext,
} from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import type { OfflineItemRecord } from "@/lib/offline";
import {
  renderWithListenProviders,
  createMockAuthUser,
  createMockAuthValue,
  createMockOfflineValue,
  createMockPlayerActions,
  createMockPlayerState,
} from "@/test/render-with-listen-providers";
import { JOURNEY_ALBUM } from "@/test/fixtures/album-journey";
const savedAlbum = {
  id: 42,
  artist: "Crossed",
  name: "MORIR",
  slug: "morir",
  year: "2022",
  has_cover: true,
  track_count: 1,
  total_duration: 128,
  saved_at: "2026-10-19T12:00:00Z",
};
let saved = false;
const writes: { path: string; body: unknown }[] = [];
vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string) => ({
    data: url === "/api/catalog/me/albums" ? [savedAlbum] : JOURNEY_ALBUM,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", async (original) => {
  const actual = await original<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: async (path: string, method = "GET", body?: unknown) => {
      if (method === "POST") {
        writes.push({ path, body });
        if (path === "/api/me/albums") saved = true;
        return { ok: true };
      }
      if (path === "/api/auth/config") return { invite_only: false };
      if (path === "/api/catalog/me/albums/saved")
        return saved ? [savedAlbum] : [];
      return [];
    },
    getApiBase: () => "",
    getAuthToken: () => null,
    resolveMaybeApiAssetUrl: (value: string) => value,
  };
});
vi.mock("@/components/auth/OAuthButtons", () => ({ OAuthButtons: () => null }));
vi.mock("@/components/bandcamp/BandcampSupportButton", () => ({
  BandcampSupportButton: () => null,
}));
vi.mock("@/hooks/use-lazy-crate-options", () => ({
  useLazyCrateOptions: () => ({
    crateOptions: [],
    ensureCrateOptionsLoaded: vi.fn(),
  }),
}));
vi.mock("@/contexts/PlaylistComposerContext", () => ({
  useOptionalPlaylistComposer: () => null,
  usePlaylistComposer: () => ({ openCreatePlaylist: vi.fn() }),
}));
vi.mock("@/contexts/CrateComposerContext", () => ({
  useOptionalCrateComposer: () => null,
  openCrateComposerForAlbum: vi.fn(),
}));
vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: vi.fn(),
    likeTrack: vi.fn(),
  }),
}));
// Boundaries are controlled here; actual pages, routes, save provider, queue and seek remain real.
vi.mock("@/contexts/PlayerContext", async (original) => ({
  ...(await original<typeof import("@/contexts/PlayerContext")>()),
  PlayerProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/OfflineContext", async (original) => ({
  ...(await original<typeof import("@/contexts/OfflineContext")>()),
  OfflineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
function Journey() {
  const [loggedIn, setLoggedIn] = useState(false),
    [online, setOnline] = useState(true),
    [queue, setQueue] = useState<Track[]>([]),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [open, setOpen] = useState(false),
    [items, setItems] = useState<OfflineItemRecord[]>([]);
  const user = createMockAuthUser();
  const currentTrack = queue[0];
  const offline = createMockOfflineValue({
    items,
    getAlbumState: () => (items.length ? "ready" : "idle"),
    getAlbumRecord: () => items[0] ?? null,
    toggleAlbumOffline: async ({ albumId }) => {
      if (albumId !== 42) throw Error("Wrong offline album");
      setItems([
        {
          key: "album:42",
          kind: "album",
          entityId: "42",
          title: "MORIR",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          readyAssetKeys: ["track-entity-101"],
          tracks: [
            {
              entity_uid: "track-entity-101",
              track_id: 101,
              title: "CULPA",
              artist: "Crossed",
              album: "MORIR",
              duration: 128,
              stream_url: "/api/tracks/101/stream",
              download_url: "/api/tracks/101/download",
            },
          ],
        },
      ]);
      return "enabled";
    },
  });
  return (
    <AuthContext.Provider
      value={createMockAuthValue({
        user: online && loggedIn ? user : null,
        accessMode: online
          ? loggedIn
            ? "authenticated"
            : "unauthenticated"
          : "offline",
        offlineIdentity: !online
          ? {
              schemaVersion: 1,
              serverId: "sample",
              serverUrl: "https://sample.example.test",
              userId: 1,
              profileKey: "sample-1",
              generation: 1,
            }
          : null,
        refetch: async () => {
          setLoggedIn(true);
          return user;
        },
      })}
    >
      <OfflineContext.Provider value={offline}>
        <PlayerActionsContext.Provider
          value={createMockPlayerActions({
            queue,
            currentTrack,
            playAll: (tracks) => {
              setQueue(tracks);
              setPlaying(true);
              setPosition(0);
            },
            seek: setPosition,
            pause: () => setPlaying(false),
            resume: () => setPlaying(true),
          })}
        >
          <PlayerStateContext.Provider
            value={createMockPlayerState({ isPlaying: playing })}
          >
            <PlayerProgressContext.Provider
              value={{
                currentTime: position,
                duration: currentTrack?.duration ?? 0,
              }}
            >
              <SavedAlbumsProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/library" element={<LibraryAlbumsTab />} />
                  <Route path="/" element={<LibraryAlbumsTab />} />
                  <Route
                    path="/artists/:artistSlug/:albumSlug"
                    element={<Album />}
                  />
                  <Route
                    path="/albums/:albumId/:albumSlug"
                    element={<Album />}
                  />
                  <Route path="/offline" element={<OfflineAccessRoute />} />
                </Routes>
              </SavedAlbumsProvider>
              {online && currentTrack ? (
                <>
                  <PlayerProgressLeaf onSeek={setPosition} showTimes />
                  <Button onClick={() => setOpen(true)}>Open test queue</Button>
                  <QueuePanel open={open} onClose={() => setOpen(false)} />
                </>
              ) : null}
              <Button asChild>
                <Link to="/offline" onClick={() => setOnline(false)}>
                  Disconnect test network
                </Link>
              </Button>
              {!online ? (
                <Button onClick={() => setOnline(true)}>
                  Reconnect test network
                </Button>
              ) : null}
            </PlayerProgressContext.Provider>
          </PlayerStateContext.Provider>
        </PlayerActionsContext.Provider>
      </OfflineContext.Provider>
    </AuthContext.Provider>
  );
}
it("completes access → collection → album → play → seek → queue → save/download → verified offline → reconnect", async () => {
  saved = false;
  writes.length = 0;
  const user = userEvent.setup();
  renderWithListenProviders(<Journey />, {
    route: "/login?return_to=%2Flibrary",
    path: "*",
  });
  await user.type(screen.getByLabelText("Email"), "listener@example.test");
  await user.type(screen.getByLabelText("Password"), "sample-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await user.click((await screen.findByText("MORIR")).closest("button")!);
  await screen.findByRole("heading", { name: "MORIR", level: 1 });
  await user.click(
    within(screen.getByTestId("album-action-row")).getByRole("button", {
      name: "Play",
    }),
  );
  const seek = await screen.findByRole("slider", {
    name: "Seek track position",
  });
  fireEvent.change(seek, { target: { value: "5" } });
  await waitFor(() => expect(seek).toHaveAttribute("aria-valuenow", "5"));
  await user.click(screen.getByRole("button", { name: "Open test queue" }));
  expect(await screen.findByText("3 tracks · 7:14")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close queue" }));
  await user.click(screen.getByRole("button", { name: "Add to collection" }));
  await screen.findByRole("button", { name: "Remove from collection" });
  await user.click(
    screen.getByRole("button", { name: "Make available offline" }),
  );
  await screen.findByRole("button", { name: "Remove offline copy" });
  await user.click(
    screen.getByRole("link", { name: "Disconnect test network" }),
  );
  await screen.findByRole("heading", { name: "Downloaded music" });
  await user.click(screen.getByRole("button", { name: "Play all" }));
  const offlineTransport = screen.getByRole("region", { name: "Queue" });
  expect(within(offlineTransport).getByText("CULPA")).toBeVisible();
  expect(writes).toEqual([
    {
      path: "/api/auth/login",
      body: { email: "listener@example.test", password: "sample-password" },
    },
    { path: "/api/me/albums", body: { album_id: 42 } },
  ]);
  await user.click(
    screen.getByRole("button", { name: "Reconnect test network" }),
  );
  await screen.findByRole("group", { name: "Albums" });
  expect(
    screen.queryByRole("heading", { name: "Downloaded music" }),
  ).not.toBeInTheDocument();
});
