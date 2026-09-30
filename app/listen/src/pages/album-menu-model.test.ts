import { describe, expect, it, vi } from "vitest";

import { buildAlbumMenuItems } from "@/pages/album-menu-model";

const t = ((key: string) => key) as never;

describe("buildAlbumMenuItems", () => {
  it("exposes the user's Crates and adds the album to the selected Crate", () => {
    const onAddToCrate = vi.fn();
    const items = buildAlbumMenuItems(
      {
        playlistPickerOpen: false,
        cratePickerOpen: false,
        canPersistAlbum: true,
        canAddToCrate: true,
        canSaveAlbum: true,
        saved: false,
        offlineSupported: true,
        offlineState: "idle",
        offlineButtonLabel: "Offline",
        playlists: [],
        crates: [{ id: "crate-1", name: "Year-end records" }],
        onPlay: vi.fn(),
        onPlayNext: vi.fn(),
        onTogglePlaylistPicker: vi.fn(),
        onToggleCratePicker: vi.fn(),
        onCreatePlaylist: vi.fn(),
        onAddToPlaylist: vi.fn(),
        onAddToCrate,
        onToggleSaved: vi.fn(),
        onToggleOffline: vi.fn(),
        onGoToArtist: vi.fn(),
        onShare: vi.fn(),
      },
      t,
    );

    const crateMenu = items.find((item) => item.key === "crate");

    expect(crateMenu?.type).toBe("disclosure");
    if (crateMenu?.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }

    expect(crateMenu.label).toBe("album.actions.addToCrate");
    expect(crateMenu.items).toHaveLength(1);
    const crateItem = crateMenu.items[0];
    if (!crateItem || !("label" in crateItem) || !("onSelect" in crateItem)) {
      throw new Error("Crate option missing");
    }
    expect(crateItem.label).toBe("Year-end records");

    crateItem.onSelect?.();
    expect(onAddToCrate).toHaveBeenCalledWith("crate-1");
  });

  it("does not expose the Crate picker for non-persistable albums", () => {
    const items = buildAlbumMenuItems(
      {
        playlistPickerOpen: false,
        cratePickerOpen: false,
        canPersistAlbum: false,
        canAddToCrate: false,
        canSaveAlbum: true,
        saved: false,
        offlineSupported: true,
        offlineState: "idle",
        offlineButtonLabel: "Offline",
        playlists: [],
        crates: [{ id: "crate-1", name: "Year-end records" }],
        onPlay: vi.fn(),
        onPlayNext: vi.fn(),
        onTogglePlaylistPicker: vi.fn(),
        onToggleCratePicker: vi.fn(),
        onCreatePlaylist: vi.fn(),
        onAddToPlaylist: vi.fn(),
        onAddToCrate: vi.fn(),
        onToggleSaved: vi.fn(),
        onToggleOffline: vi.fn(),
        onGoToArtist: vi.fn(),
        onShare: vi.fn(),
      },
      t,
    );

    expect(items.some((item) => item.key === "crate")).toBe(false);
  });
});
