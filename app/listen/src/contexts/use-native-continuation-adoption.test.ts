import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const engineMock = vi.hoisted(() => ({ takeAppendedTracks: vi.fn() }));
vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: engineMock,
  shouldUseAndroidNativePlayer: () => true,
}));

import {
  nativeAppendedTrackToTrack,
  useNativeContinuationAdoption,
} from "./use-native-continuation-adoption";

const shapedEntry = {
  sequence: 1,
  id: "uid-shaped",
  entityUid: "uid-shaped",
  durationMs: 200000,
  source: {
    entity_uid: "uid-shaped",
    track_id: 11,
    title: "Shaped",
    artist: "Band",
    album: "Record",
    distance: 0.2,
  },
};

const seededEntry = {
  sequence: 2,
  id: "uid-seeded",
  entityUid: "uid-seeded",
  durationMs: 180000,
  source: {
    track_entity_uid: "uid-seeded",
    track_id: 12,
    track_path: "/music/seeded.flac",
    title: "Seeded",
    artist: "Band",
  },
};

describe("nativeAppendedTrackToTrack", () => {
  it("keeps the native track id for shaped and seeded radio rows", () => {
    const shaped = nativeAppendedTrackToTrack(shapedEntry);
    const seeded = nativeAppendedTrackToTrack(seededEntry);

    expect(shaped).toMatchObject({
      id: "uid-shaped",
      title: "Shaped",
      entityUid: "uid-shaped",
    });
    expect(shaped.duration).toBe(200);
    expect(seeded).toMatchObject({
      id: "uid-seeded",
      title: "Seeded",
      entityUid: "uid-seeded",
    });
  });
});

describe("useNativeContinuationAdoption", () => {
  it("adopts appended tracks the queue does not have yet", async () => {
    engineMock.takeAppendedTracks.mockResolvedValue([shapedEntry, seededEntry]);
    const adoptTracks = vi.fn();
    const queueRef = {
      current: [{ id: "uid-shaped", title: "Shaped", artist: "Band" }],
    };
    const { result } = renderHook(() =>
      useNativeContinuationAdoption({ adoptTracks, queueRef }),
    );

    await act(async () => {
      await result.current();
    });

    expect(adoptTracks).toHaveBeenCalledTimes(1);
    expect(
      adoptTracks.mock.calls[0]![0].map((track: { id: string }) => track.id),
    ).toEqual(["uid-seeded"]);
  });
});
