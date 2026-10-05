import { describe, expect, it, vi } from "vitest";

import { buildArtistMenuItems } from "@/components/actions/artist-actions";

const t = ((key: string) => key) as Parameters<
  typeof buildArtistMenuItems
>[0]["t"];

function handlers() {
  return {
    onPlay: vi.fn(),
    onShuffle: vi.fn(),
    onRadio: vi.fn(),
    onToggleFollow: vi.fn(),
    onShare: vi.fn(),
  };
}

describe("buildArtistMenuItems", () => {
  it("builds the shared artist menu used by cards and the hero", () => {
    const items = buildArtistMenuItems({ following: false, t, ...handlers() });

    expect(items.map((item) => item.key)).toEqual([
      "play",
      "shuffle",
      "divider-artist-main",
      "follow",
      "radio",
      "share",
    ]);
  });

  it("adds the setlist entry when the hero provides it", () => {
    const onPlaySetlist = vi.fn();
    const items = buildArtistMenuItems({
      following: true,
      hasSetlist: false,
      onPlaySetlist,
      t,
      ...handlers(),
    });

    const setlist = items.find((item) => item.key === "setlist");
    const follow = items.find((item) => item.key === "follow");
    expect(setlist).toMatchObject({
      label: "artist.actions.playSetlist",
      disabled: true,
    });
    expect(follow).toMatchObject({
      label: "actions.artist.unfollow",
      active: true,
    });
  });

  it("disables playback, follow and radio entries independently", () => {
    const items = buildArtistMenuItems({
      following: false,
      playDisabled: true,
      followDisabled: true,
      radioDisabled: true,
      t,
      ...handlers(),
    });

    const disabled = items
      .filter((item) => "disabled" in item && item.disabled)
      .map((item) => item.key);
    expect(disabled).toEqual(["play", "shuffle", "follow", "radio"]);
  });
});
