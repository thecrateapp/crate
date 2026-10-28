import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const engineMock = vi.hoisted(() => ({
  takeAppendedTracks: vi.fn(),
  getContinuationCursor: vi.fn(),
}));
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
  it("does not adopt stale native radio continuations into a finite saved path", async () => {
    engineMock.takeAppendedTracks.mockResolvedValue([shapedEntry]);
    engineMock.getContinuationCursor.mockReturnValue({
      sessionId: "previous-radio",
      batchIndex: 2,
      revision: 1,
    });
    const adoptTracks = vi.fn();
    const { result } = renderHook(() =>
      useNativeContinuationAdoption({
        adoptTracks,
        queueRef: { current: [] },
        playSourceRef: {
          current: {
            type: "path",
            name: "Saved journey",
            id: 77,
            href: "/paths/77",
          },
        },
      }),
    );

    await act(async () => result.current());

    expect(adoptTracks).not.toHaveBeenCalled();
  });
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

it("does not adopt a previous native session while the next queue is being prepared", async () => {
  engineMock.takeAppendedTracks.mockResolvedValue([shapedEntry]);
  engineMock.getContinuationCursor.mockReturnValue({
    sessionId: "session-A",
    batchIndex: 2,
  });
  const source = {
    type: "album" as const,
    name: "B",
    radio: {
      seedType: "album" as const,
      seedId: 2,
      continuationSessionId: "session-B",
      continuationBatchIndex: 0,
    },
  };
  const adoptTracks = vi.fn();
  const { result } = renderHook(() =>
    useNativeContinuationAdoption({
      adoptTracks,
      queueRef: { current: [] },
      playSourceRef: { current: source },
    }),
  );
  await act(async () => result.current());
  expect(adoptTracks).not.toHaveBeenCalled();
  expect(source.radio.continuationBatchIndex).toBe(0);
});

it("does not read or adopt native continuation while a replacement engine queue is pending", async () => {
  engineMock.takeAppendedTracks.mockClear();
  const adoptTracks = vi.fn();
  const queueReadinessRef = { current: { ready: false, generation: 2 } };
  const { result } = renderHook(() =>
    useNativeContinuationAdoption({
      queueReadinessRef,
      adoptTracks,
      queueRef: { current: [] },
    }),
  );
  await act(async () => {
    await result.current();
  });
  expect(engineMock.takeAppendedTracks).not.toHaveBeenCalled();
  expect(adoptTracks).not.toHaveBeenCalled();
});

it("never rewinds confirmed foreground progress from an older native snapshot", async () => {
  engineMock.takeAppendedTracks.mockResolvedValue([]);
  engineMock.getContinuationCursor.mockReturnValue({
    sessionId: "session",
    batchIndex: 0,
  });
  const source = {
    type: "album" as const,
    name: "Album",
    radio: {
      seedType: "album" as const,
      seedId: 1,
      continuationSessionId: "session",
      continuationBatchIndex: 2,
    },
  };
  const { result } = renderHook(() =>
    useNativeContinuationAdoption({
      adoptTracks: vi.fn(),
      queueRef: { current: [] },
      playSourceRef: { current: source },
    }),
  );
  await act(async () => {
    await result.current();
  });
  expect(source.radio.continuationBatchIndex).toBe(2);
});

it("revision removal: adopts the same session cursor and tracks despite an obsolete numeric extra", async () => {
  engineMock.takeAppendedTracks.mockResolvedValue([shapedEntry]);
  engineMock.getContinuationCursor.mockReturnValue({
    sessionId: "session",
    batchIndex: 8,
    revision: 99,
  });
  const source = {
    type: "album" as const,
    name: "Album",
    radio: {
      seedType: "album" as const,
      seedId: 1,
      continuationSessionId: "session",
      continuationBatchIndex: 2,
    },
  };
  const adoptTracks = vi.fn();
  const { result } = renderHook(() =>
    useNativeContinuationAdoption({
      adoptTracks,
      queueRef: { current: [] },
      playSourceRef: { current: source },
    }),
  );
  await act(async () => {
    await result.current();
  });
  expect(source.radio.continuationBatchIndex).toBe(8);
  expect(source.radio).not.toHaveProperty("continuationRevision");
  expect(adoptTracks).toHaveBeenCalledOnce();
  expect(adoptTracks.mock.calls[0]?.[0][0].id).toBe("uid-shaped");
});

it("revision removal: keeps the generation guard while native tracks are in flight", async () => {
  let complete!: (entries: (typeof shapedEntry)[]) => void;
  engineMock.takeAppendedTracks.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  engineMock.getContinuationCursor.mockReturnValue({
    sessionId: "session",
    batchIndex: 8,
  });
  const source = {
    type: "radio" as const,
    name: "Radio",
    radio: {
      seedType: "track" as const,
      continuationSessionId: "session",
      continuationBatchIndex: 2,
    },
  };
  const readiness = { current: { ready: true, generation: 2 } };
  const adoptTracks = vi.fn();
  const { result } = renderHook(() =>
    useNativeContinuationAdoption({
      queueReadinessRef: readiness,
      adoptTracks,
      queueRef: { current: [] },
      playSourceRef: { current: source },
    }),
  );

  await act(async () => {
    const pending = result.current();
    readiness.current.generation++;
    complete([shapedEntry]);
    await pending;
  });

  expect(source.radio.continuationBatchIndex).toBe(2);
  expect(adoptTracks).not.toHaveBeenCalled();
});
