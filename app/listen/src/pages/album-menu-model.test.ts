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
        onCreateCrate: vi.fn(),
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
    expect(crateMenu.items).toHaveLength(2);
    const createCrateItem = crateMenu.items[0];
    if (!createCrateItem || !("label" in createCrateItem)) {
      throw new Error("Create Crate option missing");
    }
    expect(createCrateItem.label).toBe("library.crates.create");
    const crateItem = crateMenu.items[1];
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
        onCreateCrate: vi.fn(),
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

  it("keeps the playlist picker when no Crates exist yet", () => {
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
        crates: [],
        onPlay: vi.fn(),
        onPlayNext: vi.fn(),
        onTogglePlaylistPicker: vi.fn(),
        onToggleCratePicker: vi.fn(),
        onCreatePlaylist: vi.fn(),
        onCreateCrate: vi.fn(),
        onAddToPlaylist: vi.fn(),
        onAddToCrate: vi.fn(),
        onToggleSaved: vi.fn(),
        onToggleOffline: vi.fn(),
        onGoToArtist: vi.fn(),
        onShare: vi.fn(),
      },
      t,
    );

    expect(items.some((item) => item.key === "crate")).toBe(true);
    const crateMenu = items.find((item) => item.key === "crate");
    if (crateMenu?.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }
    expect(crateMenu.items).toHaveLength(1);
    const createCrateItem = crateMenu.items[0];
    if (!createCrateItem || !("label" in createCrateItem)) {
      throw new Error("Create Crate option missing");
    }
    expect(createCrateItem.label).toBe("library.crates.create");
    expect(items.some((item) => item.key === "playlist")).toBe(true);
  });

  it("hides the Crate picker when the album cannot be added to a Crate", () => {
    const items = buildAlbumMenuItems(
      {
        playlistPickerOpen: false,
        cratePickerOpen: false,
        canPersistAlbum: true,
        canAddToCrate: false,
        canSaveAlbum: true,
        saved: false,
        offlineSupported: true,
        offlineState: "idle",
        offlineButtonLabel: "Offline",
        playlists: [],
        crates: [],
        onPlay: vi.fn(),
        onPlayNext: vi.fn(),
        onTogglePlaylistPicker: vi.fn(),
        onToggleCratePicker: vi.fn(),
        onCreatePlaylist: vi.fn(),
        onCreateCrate: vi.fn(),
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
    expect(items.some((item) => item.key === "playlist")).toBe(true);
  });
});
