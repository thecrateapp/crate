import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EngineMixState,
  EngineQueueSnapshot,
  EngineState,
} from "./playback-engine";

const native = vi.hoisted(() => ({
  getState: vi.fn(),
  setQueue: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  setContinuation: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
vi.mock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
vi.mock("@/lib/playback-continuation", () => ({
  getPlaybackContinuationToken: vi.fn(),
}));
const mix: EngineMixState = {
  revision: "queue-a",
  executionId: 4,
  mode: "beatmatch",
  phase: "mixing",
  bassHandoff: true,
  outgoingTrackId: "a",
  incomingTrackId: "b",
};
const state: EngineState = {
  revision: "queue-a",
  playbackState: "playing",
  isPlaying: true,
  index: 0,
  positionMs: 1000,
  durationMs: 90000,
  queueSize: 2,
  crossfadeMs: 4000,
  eqEnabled: false,
};
const queue: EngineQueueSnapshot = {
  revision: "queue-a",
  tracks: [],
  currentIndex: 0,
  positionMs: 0,
  autoplay: false,
  repeat: "off",
  crossfadeMs: 0,
  volume: 1,
};
describe("native mix snapshots", () => {
  beforeEach(() => {
    native.getState.mockResolvedValue(state);
    native.setQueue.mockImplementation((next: EngineQueueSnapshot) =>
      Promise.resolve({ ...state, revision: next.revision }),
    );
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });
  it("normalizes old plugin snapshots to unknown and adopts their current revision on cold start", async () => {
    const { AndroidNativeEngine } = await import("./android-native-engine");
    const engine = new AndroidNativeEngine();
    await expect(engine.getState()).resolves.toEqual({
      ...state,
      mixState: null,
    });
    expect(engine.isCurrentQueueRevision("queue-a")).toBe(true);
  });
  it("restores real technique and applied bass handoff without consulting transition plans", async () => {
    native.getState.mockResolvedValue({ ...state, mixState: mix });
    const { AndroidNativeEngine } = await import("./android-native-engine");
    const engine = new AndroidNativeEngine();
    await expect(engine.getState()).resolves.toMatchObject({ mixState: mix });
  });
  it("drops a pending snapshot when a new queue is requested, even with a reused revision", async () => {
    const { AndroidNativeEngine } = await import("./android-native-engine");
    const engine = new AndroidNativeEngine();
    let resolve!: (value: EngineState) => void;
    native.getState.mockResolvedValueOnce(state).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = engine.getState();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    await engine.loadQueue(queue);
    resolve({ ...state, mixState: mix });
    await expect(pending).resolves.toBeNull();
    expect(engine.isCurrentQueueRevision("queue-a")).toBe(true);
  });
  it("rejects snapshots from an old native revision without changing current queue identity", async () => {
    const { AndroidNativeEngine } = await import("./android-native-engine");
    const engine = new AndroidNativeEngine();
    await engine.loadQueue({ ...queue, revision: "queue-b" });
    native.getState.mockResolvedValue({ ...state, mixState: mix });
    await expect(engine.getState()).resolves.toBeNull();
    expect(engine.isCurrentQueueRevision("queue-b")).toBe(true);
  });
  it("does not let an obsolete load replace the current queue after a permission await", async () => {
    const { AndroidNativeEngine } = await import("./android-native-engine");
    const engine = new AndroidNativeEngine();
    let resolve!: (value: { notifications: "granted" }) => void;
    native.checkPermissions.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const obsolete = engine.loadQueue({ ...queue, autoplay: true });
    const result = expect(obsolete).rejects.toThrow("superseded");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    await engine.loadQueue({ ...queue, revision: "queue-b" });
    resolve({ notifications: "granted" });
    await result;
    expect(native.setQueue).toHaveBeenCalledTimes(1);
    expect(native.setQueue).toHaveBeenCalledWith(
      expect.objectContaining({ revision: "queue-b" }),
    );
    expect(engine.isCurrentQueueRevision("queue-b")).toBe(true);
  });
});
