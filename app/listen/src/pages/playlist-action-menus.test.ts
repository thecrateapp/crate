import { describe, expect, it, vi } from "vitest";

import { ArrowDownToLine } from "@crate/ui/icons";

import {
  buildPlaylistPageActions,
  getPlaylistOfflineIcon,
  type PlaylistPageActionInput,
} from "@/pages/playlist-action-menus";

function buildInput(
  overrides: Partial<PlaylistPageActionInput> = {},
): PlaylistPageActionInput {
  return {
    t: ((key: string) => key) as PlaylistPageActionInput["t"],
    playDisabled: true,
    onPlay: vi.fn(),
    onShuffle: vi.fn(),
    onRadio: vi.fn(),
    onShare: vi.fn(),
    offline: {
      state: "idle",
      presentation: { busy: false, buttonLabel: "Make available offline" },
      supported: true,
      isSmart: false,
      onToggle: vi.fn(),
    },
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function keys(input: PlaylistPageActionInput) {
  const actions = buildPlaylistPageActions(input);
  return {
    secondary: actions.secondaryActions.map((action) => action.key),
    menu: actions.playlistMenuItems.map((item) => item.key),
  };
}

describe("playlist action menus", () => {
  it("keeps the regular playlist action order and visibility", () => {
    expect(keys(buildInput())).toEqual({
      secondary: ["radio", "offline", "edit", "share"],
      menu: [
        "play",
        "shuffle",
        "radio",
        "divider-playlist-library",
        "offline",
        "edit",
        "divider-playlist-share",
        "share",
        "divider-playlist-danger",
        "delete",
      ],
    });
  });

  it("adds collaborator and smart-playlist actions only when applicable", () => {
    const input = buildInput({
      onCollaborators: vi.fn(),
      onRegenerate: vi.fn(),
    });

    expect(keys(input)).toEqual({
      secondary: ["radio", "offline", "collaborators", "edit", "share"],
      menu: [
        "play",
        "shuffle",
        "radio",
        "divider-playlist-library",
        "offline",
        "collaborators",
        "edit",
        "regenerate",
        "divider-playlist-share",
        "share",
        "divider-playlist-danger",
        "delete",
      ],
    });
  });

  it("builds the curated playlist surface from the same builder", () => {
    const input = buildInput({
      onEdit: undefined,
      onDelete: undefined,
      follow: { followed: false, pending: false, onToggle: vi.fn() },
    });

    expect(keys(input)).toEqual({
      secondary: ["radio", "offline", "follow", "share"],
      menu: [
        "play",
        "shuffle",
        "radio",
        "divider-playlist-library",
        "follow",
        "offline",
        "divider-playlist-share",
        "share",
      ],
    });
  });

  it("omits offline actions for generated playlists", () => {
    const input = buildInput({
      offline: undefined,
      onEdit: undefined,
      onDelete: undefined,
    });

    expect(keys(input)).toEqual({
      secondary: ["radio", "share"],
      menu: ["play", "shuffle", "radio", "divider-playlist-share", "share"],
    });
  });

  it("disables playback entries while the playlist has no playable tracks", () => {
    const { playlistMenuItems } = buildPlaylistPageActions(buildInput());
    const play = playlistMenuItems.find((item) => item.key === "play");
    expect(play).toMatchObject({ disabled: true });
  });

  it("uses the download icon state shared by both menu surfaces", () => {
    expect(getPlaylistOfflineIcon("idle", { busy: false })).toBe(
      ArrowDownToLine,
    );
    expect(getPlaylistOfflineIcon("ready", { busy: false })).not.toBe(
      ArrowDownToLine,
    );
  });
});
