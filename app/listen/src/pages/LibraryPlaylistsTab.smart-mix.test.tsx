import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@crate/ui/lib/notify";

import { api, ApiError } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryPlaylistsTab } from "./LibraryPlaylistsTab";

const state = vi.hoisted(() => ({
  smartMixPlaylists: true,
  refetch: vi.fn(),
}));

const owned = {
  id: 10,
  user_id: 1,
  name: "Domingo",
  description: "",
  track_count: 412,
  total_duration: 0,
  is_smart: false,
  created_at: "2026-10-24",
  smartMix: { enabled: false, ready: 0, total: 0 },
};
const shared = {
  ...owned,
  id: 32,
  user_id: 7,
  name: "Neurosis 4 Dur",
  owner_username: "gon.posse",
  smartMix: { enabled: true, ready: 9, total: 20 },
};

vi.mock("@/contexts/AuthContext", async (original) => ({
  ...(await original<typeof import("@/contexts/AuthContext")>()),
  useAuth: () => ({ user: { id: 1 } }),
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string) =>
    url === "/api/capabilities"
      ? {
          data: {
            smart_mix: { stems: { playlists: state.smartMixPlaylists } },
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        }
      : {
          data: { playlists: [owned, shared], followed_curated_playlists: [] },
          loading: false,
          error: null,
          refetch: state.refetch,
        },
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
    name,
    smartMix,
    onToggleSmartMix,
  }: {
    name: string;
    smartMix?: { enabled: boolean; ready: number; total: number } | null;
    onToggleSmartMix?: () => void;
  }) => (
    <article aria-label={name}>
      <span>
        {smartMix ? `smart mix ${smartMix.ready}/${smartMix.total}` : "no mark"}
      </span>
      {onToggleSmartMix ? (
        <button onClick={onToggleSmartMix}>Toggle {name}</button>
      ) : null}
    </article>
  ),
}));

describe("LibraryPlaylistsTab Smart Mix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.smartMixPlaylists = true;
  });

  it("marks Smart Mix playlists only where the server offers them", () => {
    const { unmount } = renderWithListenProviders(<LibraryPlaylistsTab />);
    expect(
      screen.getByRole("article", { name: "Neurosis 4 Dur" }),
    ).toHaveTextContent("smart mix 9/20");
    // Only the owner turns it on or off.
    expect(
      screen.getByRole("button", { name: "Toggle Domingo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Toggle Neurosis 4 Dur" }),
    ).toBeNull();
    unmount();

    state.smartMixPlaylists = false;
    renderWithListenProviders(<LibraryPlaylistsTab />);
    expect(
      screen.getByRole("article", { name: "Neurosis 4 Dur" }),
    ).toHaveTextContent("no mark");
    expect(screen.queryByRole("button", { name: /^Toggle/ })).toBeNull();
  });

  it("turns Smart Mix on for the owner and reloads the list", async () => {
    vi.mocked(api).mockResolvedValue({ playlistId: 10, enabled: true });
    renderWithListenProviders(<LibraryPlaylistsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Domingo" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/smart-mix/playlists/10", "PUT", {
        enabled: true,
      }),
    );
    expect(notify.success).toHaveBeenCalledWith("Smart Mix is on for Domingo");
    expect(state.refetch).toHaveBeenCalled();
  });

  it.each([
    [
      "en",
      "Smart Mix stays off for Domingo",
      "A Smart Mix playlist holds at most 300 tracks on this server; Domingo has 412.",
    ],
    [
      "es",
      "Smart Mix sigue desactivado en Domingo",
      "En este servidor, una playlist de Smart Mix admite como máximo 300 canciones; Domingo tiene 412.",
    ],
  ] as const)(
    "explains a refused Smart Mix in %s from the 409's fields",
    async (locale, title, description) => {
      vi.mocked(api).mockRejectedValue(
        new ApiError(
          409,
          JSON.stringify({
            detail: "A Smart Mix playlist holds at most 300 tracks",
            limit: "playlist",
            maxTracks: 300,
            tracks: 412,
          }),
        ),
      );
      renderWithListenProviders(<LibraryPlaylistsTab />, { locale });

      fireEvent.click(screen.getByRole("button", { name: "Toggle Domingo" }));

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith(title, { description }),
      );
      expect(state.refetch).not.toHaveBeenCalled();
    },
  );

  it("falls back to a plain error for other failures", async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(500, "boom"));
    renderWithListenProviders(<LibraryPlaylistsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Domingo" }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        "Could not change Smart Mix for Domingo",
      ),
    );
  });
});
