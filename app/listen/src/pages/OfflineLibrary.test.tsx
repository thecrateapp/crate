import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineItemRecord } from "@/lib/offline";

const { playAllMock, itemsMock } = vi.hoisted(() => ({
  playAllMock: vi.fn(),
  itemsMock: vi.fn<() => OfflineItemRecord[]>(() => []),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/contexts/OfflineContext", () => ({
  useOffline: () => ({ items: itemsMock() }),
}));
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    playAll: playAllMock,
    currentTrack: null,
    isPlaying: false,
    pause: vi.fn(),
    resume: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
  }),
  usePlayerProgress: () => ({ currentTime: 0, duration: 0 }),
  usePlayerState: () => ({ isBuffering: false, isPlaying: false }),
}));

import { OfflineLibrary } from "@/pages/OfflineLibrary";

describe("OfflineLibrary", () => {
  beforeEach(() => {
    playAllMock.mockReset();
    itemsMock.mockReset().mockReturnValue([
      {
        key: "album:1",
        kind: "album",
        entityId: "1",
        title: "Saved Album",
        state: "ready",
        trackCount: 1,
        readyTrackCount: 1,
        readyAssetKeys: ["entity-1"],
        tracks: [
          {
            entity_uid: "entity-1",
            title: "Saved Song",
            artist: "Saved Band",
            stream_url: "/api/tracks/1/stream",
            download_url: "/api/tracks/1/download",
          },
        ],
      },
    ]);
  });

  it("plays only the verified local tracks from the saved item", () => {
    render(<OfflineLibrary />);

    expect(screen.getAllByText("offline.access.status")).toHaveLength(2);
    expect(screen.getByText("Saved Album")).toBeInTheDocument();
    expect(screen.getByText("Saved Song")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "offline.access.playAll" }),
    );

    expect(playAllMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entityUid: "entity-1",
          offlineOnly: true,
        }),
      ],
      0,
      { type: "album", name: "Saved Album", id: "1" },
    );
  });
});
