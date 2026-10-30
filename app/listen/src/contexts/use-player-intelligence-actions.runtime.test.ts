import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Track } from "./player-types";
const mocks = vi.hoisted(() => ({
  cast: false,
  native: false,
  nativeAppend: vi.fn(),
  sync: vi.fn(),
  add: vi.fn(),
  jump: vi.fn(),
}));
vi.mock("@/lib/cast-sender", () => ({
  isCustomCastSessionActive: () => mocks.cast,
  syncCustomCastQueue: mocks.sync,
  castQueueJumpTo: mocks.jump,
}));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => mocks.native,
  androidNativeEngine: { appendTracks: mocks.nativeAppend },
}));
vi.mock("@/contexts/player-engine-adapter", () => ({
  toFreshEngineTracks: vi.fn(async (tracks: Track[]) =>
    tracks.map((track) => ({ ...track, url: `/stream/${track.id}` })),
  ),
}));
vi.mock("@/lib/gapless-player", () => ({
  addTrack: mocks.add,
  gotoTrack: vi.fn(),
  insertTrack: vi.fn(),
}));
import { usePlayerIntelligenceActions } from "./use-player-intelligence-actions";
const track = (id: string): Track => ({ id, title: id, artist: "Artist" });
function setup(queueReadinessRef?: {
  current: { ready: boolean; generation: number };
}) {
  const queueRef = { current: [track("old"), track("current")] };
  const commitQueue = vi.fn((queue: Track[]) => {
    queueRef.current = queue;
  });
  const options = {
    queueReadinessRef,
    queueRef,
    commitQueue,
    currentIndexRef: { current: 1 },
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
    advanceCursorTo: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitIsPlaying: vi.fn(),
    flushCurrentPlayEvent: vi.fn(),
    playSourceRef: { current: null },
    recentlyPlayed: [track("old")],
    registerEngineTrack: (t: Track) => t.id,
    startTrackerSession: vi.fn(),
    unshuffledQueueRef: { current: null },
  };
  const { result } = renderHook(() => usePlayerIntelligenceActions(options));
  return { result, options };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cast = false;
  mocks.native = false;
  mocks.sync.mockResolvedValue({ ok: true });
});
it("deduplicates the active buffer while permitting a historical track", async () => {
  const { result, options } = setup();
  let count = 0;
  await act(async () => {
    count = await result.current.appendIntelligenceTracks([
      track("old"),
      track("current"),
      track("new"),
      track("new"),
    ]);
  });
  expect(count).toBe(2);
  expect(options.queueRef.current.map((t) => t.id)).toEqual([
    "old",
    "current",
    "old",
    "new",
  ]);
});
it("commits a Cast append only after the receiver ACK without reloading playback", async () => {
  mocks.cast = true;
  let ack!: (r: { ok: boolean }) => void;
  mocks.sync.mockImplementation(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const { result, options } = setup();
  const pending = result.current.appendIntelligenceTracks([track("new")]);
  expect(options.commitQueue).not.toHaveBeenCalled();
  expect(mocks.sync).toHaveBeenCalledWith(
    expect.objectContaining({
      currentIndex: 1,
      repeatMode: "off",
      shuffle: false,
    }),
    expect.any(Function),
  );
  await act(async () => {
    ack({ ok: true });
    expect(await pending).toBe(1);
  });
  expect(options.commitQueue).toHaveBeenCalledOnce();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.jump).not.toHaveBeenCalled();
});
it("does not report progress on a failed Cast append", async () => {
  mocks.cast = true;
  mocks.sync.mockResolvedValue({ ok: false, message: "rejected" });
  const { result, options } = setup();
  await expect(
    result.current.appendIntelligenceTracks([track("new")]),
  ).rejects.toThrow("rejected");
  expect(options.commitQueue).not.toHaveBeenCalled();
});
it("does not commit or resume after cancellation during the ACK", async () => {
  mocks.cast = true;
  let current = true;
  let ack!: (r: { ok: boolean }) => void;
  mocks.sync.mockImplementation(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const { result, options } = setup();
  const pending = result.current.appendAndAdvance(
    [track("new")],
    () => current,
  );
  current = false;
  await act(async () => {
    ack({ ok: true });
    expect(await pending).toBe(0);
  });
  expect(options.commitQueue).not.toHaveBeenCalled();
  expect(options.commitIsPlaying).not.toHaveBeenCalled();
});

it("blocks appends and advances before the selected queue reaches its engine", async () => {
  const { result, options } = setup({
    current: { ready: false, generation: 2 },
  });
  expect(await result.current.appendIntelligenceTracks([track("new")])).toBe(0);
  expect(await result.current.appendAndAdvance([track("new")])).toBe(0);
  expect(options.commitQueue).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("reserves native additions while the ACK is pending so manual appends preserve both orders", async () => {
  mocks.native = true;
  let ack!: (state: object) => void;
  mocks.nativeAppend.mockImplementation(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const { result, options } = setup();
  const pending = result.current.appendIntelligenceTracks([track("automatic")]);
  await act(async () => {});
  expect(options.queueRef.current.map((track) => track.id)).toEqual([
    "old",
    "current",
    "automatic",
  ]);
  options.commitQueue([...options.queueRef.current, track("manual")]);
  await act(async () => {
    ack({});
    expect(await pending).toBe(1);
  });
  expect(options.queueRef.current.map((track) => track.id)).toEqual([
    "old",
    "current",
    "automatic",
    "manual",
  ]);
});

it("rolls back only a failed native reservation, retaining a manual edit", async () => {
  mocks.native = true;
  let fail!: (error: Error) => void;
  mocks.nativeAppend.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { result, options } = setup();
  const pending = result.current.appendIntelligenceTracks([track("automatic")]);
  const rejected = expect(pending).rejects.toThrow("native rejected");
  await act(async () => {});
  options.commitQueue([...options.queueRef.current, track("manual")]);
  await act(async () => {
    fail(new Error("native rejected"));
    await rejected;
  });
  expect(options.queueRef.current.map((track) => track.id)).toEqual([
    "old",
    "current",
    "manual",
  ]);
});

it("reports an acknowledged native append after Pause without advancing or resuming", async () => {
  mocks.native = true;
  let active = true;
  let ack!: (state: object) => void;
  mocks.nativeAppend.mockImplementation(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const { result, options } = setup();
  const pending = result.current.appendAndAdvance(
    [track("automatic")],
    () => active,
  );
  await act(async () => {});
  active = false;
  await act(async () => {
    ack({});
    expect(await pending).toBe(1);
  });
  expect(options.commitIsPlaying).not.toHaveBeenCalled();
  expect(options.advanceCursorTo).not.toHaveBeenCalled();
});
