import { describe, expect, it } from "vitest";

import {
  createPlayerQueueSnapshot,
  findTrackIndex,
  getJamQueueSyncPlan,
} from "@/contexts/player-session";
import type { Track } from "@/contexts/player-types";

const firstTrack: Track = {
  id: "first-local-id",
  globalTrackUid: "track:first",
  title: "First",
  artist: "Artist",
  path: "/music/first.flac",
};

const secondTrack: Track = {
  id: "second-local-id",
  globalTrackUid: "track:second",
  title: "Second",
  artist: "Artist",
  path: "/music/second.flac",
};

describe("player Jam session helpers", () => {
  it("finds a track by a stable identity when the local id changes", () => {
    expect(
      findTrackIndex([firstTrack, secondTrack], {
        ...secondTrack,
        id: "remote-second-id",
      }),
    ).toBe(1);
  });

  it("matches the same library track when room and local ids differ", () => {
    expect(
      findTrackIndex(
        [
          {
            ...firstTrack,
            id: "local-id",
            globalTrackUid: undefined,
            entityUid: undefined,
            path: "/music/local.flac",
            libraryTrackId: 42,
          },
        ],
        {
          ...firstTrack,
          id: "room-id",
          globalTrackUid: undefined,
          entityUid: undefined,
          path: "/music/room.flac",
          libraryTrackId: 42,
        },
      ),
    ).toBe(0);
  });

  it("keeps the active track and playback position when a Jam queue changes", () => {
    expect(
      getJamQueueSyncPlan({
        currentQueue: [firstTrack, secondTrack],
        currentIndex: 0,
        currentTime: 42,
        isPlaying: true,
        nextQueue: [secondTrack, firstTrack],
      }),
    ).toEqual({
      currentIndex: 1,
      positionSeconds: 42,
      playing: true,
    });
  });

  it("starts the replacement track from zero when the active track is removed", () => {
    expect(
      getJamQueueSyncPlan({
        currentQueue: [firstTrack, secondTrack],
        currentIndex: 0,
        currentTime: 42,
        isPlaying: true,
        nextQueue: [secondTrack],
      }),
    ).toEqual({
      currentIndex: 0,
      positionSeconds: 0,
      playing: true,
    });
  });

  it("captures a copy of the local queue before entering a Jam", () => {
    const queue = [firstTrack, secondTrack];
    const snapshot = createPlayerQueueSnapshot({
      queue,
      currentIndex: 1,
      currentTime: 12.5,
      isPlaying: true,
      shuffle: false,
      repeat: "off",
      playSource: { type: "album", name: "Album" },
      unshuffledQueue: queue,
    });

    queue.pop();

    expect(snapshot.queue).toEqual([firstTrack, secondTrack]);
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.currentTime).toBe(12.5);
    expect(snapshot.playSource).toEqual({ type: "album", name: "Album" });
    expect(snapshot.unshuffledQueue).toEqual([firstTrack, secondTrack]);
  });
});
