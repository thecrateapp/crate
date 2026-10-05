import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { buildBandcampActions } from "./bandcamp-actions";
import { buildJamRoomActions } from "./jam-actions";
import { buildPathActions, pathPagePath } from "./path-actions";
import { buildReleaseActions } from "./show-actions";

const t = ((key: string) => key) as unknown as TFunction;

function summary(entries: ReturnType<typeof buildPathActions>) {
  return entries.map((entry) => ({
    key: entry.key,
    label: "label" in entry ? entry.label : undefined,
    disabled: "disabled" in entry ? entry.disabled : undefined,
    danger: "danger" in entry ? entry.danger : undefined,
  }));
}

describe("buildJamRoomActions", () => {
  it("opens member rooms and lets hosts delete", () => {
    const entries = buildJamRoomActions(
      { isMember: true, isHost: true, onJoin: vi.fn(), onDelete: vi.fn() },
      t,
    );
    expect(summary(entries)).toEqual([
      expect.objectContaining({ key: "open", label: "actions.jam.open" }),
      expect.objectContaining({
        key: "delete",
        label: "jam.delete.title",
        danger: true,
      }),
    ]);
  });

  it("offers join for public rooms and hides delete for guests", () => {
    const entries = buildJamRoomActions(
      {
        isMember: false,
        isHost: false,
        joining: true,
        onJoin: vi.fn(),
        onDelete: vi.fn(),
      },
      t,
    );
    expect(summary(entries)).toEqual([
      expect.objectContaining({
        key: "open",
        label: "jam.lobby.joinRoom",
        disabled: true,
      }),
    ]);
  });
});

describe("buildPathActions", () => {
  it("builds play, open and destructive delete", () => {
    const entries = buildPathActions(
      { onPlay: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn() },
      t,
    );
    expect(summary(entries).map((entry) => entry.key)).toEqual([
      "play",
      "open",
      "delete",
    ]);
    expect(summary(entries)[2]).toMatchObject({ danger: true });
    expect(pathPagePath(4)).toBe("/paths/4");
  });
});

describe("buildBandcampActions", () => {
  it("includes import only when importable and open only with a URL", () => {
    expect(
      summary(
        buildBandcampActions(
          {
            canImport: true,
            importDisabled: true,
            itemUrl: "https://x.bandcamp.com/album/y",
            onImport: vi.fn(),
            onOpen: vi.fn(),
          },
          t,
        ),
      ),
    ).toEqual([
      expect.objectContaining({ key: "import", disabled: true }),
      expect.objectContaining({ key: "open", label: "actions.bandcamp.open" }),
    ]);
    expect(
      buildBandcampActions(
        { canImport: false, itemUrl: null, onImport: vi.fn(), onOpen: vi.fn() },
        t,
      ),
    ).toEqual([]);
  });
});

describe("buildReleaseActions", () => {
  it("navigates to album and artist", () => {
    const navigate = vi.fn();
    const entries = buildReleaseActions(
      { albumPath: "/albums/1", artistPath: "/artists/2" },
      { t, navigate },
    );
    expect(entries.map((entry) => entry.key)).toEqual(["album", "artist"]);
    for (const entry of entries) {
      if ("onSelect" in entry) void entry.onSelect();
    }
    expect(navigate).toHaveBeenCalledWith("/albums/1");
    expect(navigate).toHaveBeenCalledWith("/artists/2");
  });
});
