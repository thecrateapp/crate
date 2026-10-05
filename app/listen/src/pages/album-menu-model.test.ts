import { describe, expect, it, vi } from "vitest";

import {
  buildAlbumMenuEntries,
  type AlbumMenuOptions,
} from "@/components/actions/album-actions";

const t = ((key: string) => key) as never;

function menuOptions(overrides: Partial<AlbumMenuOptions> = {}) {
  return {
    saved: false,
    canSave: true,
    canAddToCrate: true,
    canAddToPlaylist: true,
    canRadio: true,
    canDownload: true,
    offlineEnabled: true,
    offlineState: "idle",
    offlineLabel: "Offline",
    globalAlbumUid: null,
    crates: [],
    cratePickerOpen: false,
    playlists: [],
    playlistPickerOpen: false,
    onPlay: vi.fn(),
    onPlayNext: vi.fn(),
    onShuffle: vi.fn(),
    onToggleCratePicker: vi.fn(),
    onCreateCrate: vi.fn(),
    onAddToCrate: vi.fn(),
    onTogglePlaylistPicker: vi.fn(),
    onCreatePlaylist: vi.fn(),
    onAddToPlaylist: vi.fn(),
    onToggleSaved: vi.fn(),
    onRadio: vi.fn(),
    onToggleOffline: vi.fn(),
    onDownload: vi.fn(),
    onGoToArtist: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  } satisfies AlbumMenuOptions;
}

function entryKeys(options: AlbumMenuOptions) {
  return buildAlbumMenuEntries(options, t)
    .filter((entry) => entry.type !== "divider")
    .map((entry) => entry.key);
}

describe("buildAlbumMenuEntries", () => {
  it("builds the union of album actions in a stable order", () => {
    expect(entryKeys(menuOptions())).toEqual([
      "play",
      "play-next",
      "shuffle",
      "crate",
      "playlist",
      "save",
      "radio",
      "offline",
      "download",
      "artist",
      "share",
    ]);
  });

  it("disables playback entries when the album has no playable tracks", () => {
    const entries = buildAlbumMenuEntries(
      menuOptions({ canPlay: false, canRadio: false }),
      t,
    );
    const disabledKeys = entries
      .filter((entry) => "disabled" in entry && entry.disabled)
      .map((entry) => entry.key);

    expect(disabledKeys).toEqual(
      expect.arrayContaining(["play", "play-next", "shuffle", "radio"]),
    );
  });

  it("exposes the user's Crates and adds the album to the selected Crate", () => {
    const onAddToCrate = vi.fn();
    const crate = { id: "crate-1", name: "Year-end records", albumUids: [] };
    const items = buildAlbumMenuEntries(
      menuOptions({ crates: [crate], onAddToCrate }),
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
    expect(onAddToCrate).toHaveBeenCalledWith(crate);
  });

  it("marks Crates that already contain the album", () => {
    const items = buildAlbumMenuEntries(
      menuOptions({
        globalAlbumUid: "album-uid",
        crates: [{ id: "crate-1", name: "Mine", albumUids: ["album-uid"] }],
      }),
      t,
    );
    const crateMenu = items.find((item) => item.key === "crate");
    if (crateMenu?.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }
    const crateItem = crateMenu.items[1];
    expect(crateItem && "active" in crateItem && crateItem.active).toBe(true);
  });

  it("does not expose the Crate picker for non-persistable albums", () => {
    const keys = entryKeys(
      menuOptions({ canAddToCrate: false, canAddToPlaylist: false }),
    );
    expect(keys).not.toContain("crate");
    expect(keys).not.toContain("playlist");
  });

  it("keeps the playlist picker when no Crates exist yet", () => {
    const items = buildAlbumMenuEntries(menuOptions(), t);
    const crateMenu = items.find((item) => item.key === "crate");
    if (crateMenu?.type !== "disclosure") {
      throw new Error("Crate menu missing");
    }
    expect(crateMenu.items).toHaveLength(1);
    expect(items.some((item) => item.key === "playlist")).toBe(true);
  });

  it("disables unavailable actions instead of hiding them", () => {
    const items = buildAlbumMenuEntries(
      menuOptions({
        canSave: false,
        canRadio: false,
        canDownload: false,
        offlineEnabled: false,
      }),
      t,
    );
    for (const key of ["save", "radio", "download", "offline"]) {
      const entry = items.find((item) => item.key === key);
      expect(entry && "disabled" in entry && entry.disabled).toBe(true);
    }
  });
});
