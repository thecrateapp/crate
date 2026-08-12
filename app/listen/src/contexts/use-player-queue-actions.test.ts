import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  androidLoadQueueMock,
  androidInsertTrackMock,
  androidRemoveTrackMock,
  shouldUseAndroidNativePlayerMock,
  castPauseMock,
  castPlayMock,
  castSeekMock,
  castSetVolumeMock,
  isCastSessionActiveMock,
  startCastSessionMock,
} = vi.hoisted(() => ({
  androidLoadQueueMock: vi.fn(),
  androidInsertTrackMock: vi.fn(),
  androidRemoveTrackMock: vi.fn(),
  shouldUseAndroidNativePlayerMock: vi.fn(() => false),
  castPauseMock: vi.fn(),
  castPlayMock: vi.fn(),
  castSeekMock: vi.fn(),
  castSetVolumeMock: vi.fn(),
  isCastSessionActiveMock: vi.fn(),
  startCastSessionMock: vi.fn(),
}));

import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import type { Track } from "@/contexts/player-types";
import * as gaplessPlayer from "@/lib/gapless-player";

vi.mock("@/contexts/player-engine-adapter", () => ({
  toFreshEngineTrack: vi.fn(async (track: Track) => ({
    url: track.path || track.id,
  })),
  toStartupEngineTracks: vi.fn(async (tracks: Track[]) =>
    tracks.map((track) => ({ url: track.path || track.id })),
  ),
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: {
    insertTrack: androidInsertTrackMock,
    loadQueue: androidLoadQueueMock,
    removeTrack: androidRemoveTrackMock,
    stop: vi.fn(),
  },
  isAndroidNativePlayerAvailable: vi.fn(() => false),
  shouldUseAndroidNativePlayer: shouldUseAndroidNativePlayerMock,
}));

vi.mock("@/lib/gapless-player", () => ({
  addTrack: vi.fn(),
  fadeInAndPlay: vi.fn(),
  fadeOutAndPause: vi.fn(),
  getPosition: vi.fn(() => 0),
  gotoTrack: vi.fn(),
  insertTrack: vi.fn(),
  loadQueue: vi.fn(),
  next: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  removeTrack: vi.fn(),
  restoreVolume: vi.fn(),
  seekTo: vi.fn(),
  setLoop: vi.fn(),
  setPlaybackRate: vi.fn(),
  setSingleMode: vi.fn(),
  setVolume: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/lib/cast-sender", () => ({
  castPause: castPauseMock,
  castPlay: castPlayMock,
  castSeek: castSeekMock,
  castSetVolume: castSetVolumeMock,
  castStop: vi.fn(),
  isCastSessionActive: isCastSessionActiveMock,
  startCastSession: startCastSessionMock,
}));

const TRACK: Track = {
  id: "track-1",
  title: "Track One",
  artist: "Artist",
  album: "Album",
  path: "/music/Artist/Album/01-track.flac",
};

function createParams() {
  return {
    queueRef: { current: [] as Track[] },
    jamQueueLockedRef: { current: false },
    currentIndexRef: { current: 0 },
    currentTimeRef: { current: 0 },
    isPlayingRef: { current: false },
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
    playSourceRef: { current: null },
    unshuffledQueueRef: { current: null as Track[] | null },
    bufferingIntentRef: { current: false },
    pendingRestoreTimeRef: { current: 0 },
    resumeAfterReloadRef: { current: false },
    lastNonZeroVolumeRef: { current: 1 },
    prevRestartTrackKeyRef: { current: null as string | null },
    prevRestartedAtRef: { current: 0 },
    activatedTrackKeyRef: { current: null as string | null },
    setPlaySource: vi.fn(),
    setShuffleState: vi.fn(),
    setRepeatState: vi.fn(),
    setVolumeState: vi.fn(),
    buildEngineUrls: vi.fn((tracks: Track[]) =>
      tracks.map((track) => track.path || track.id),
    ),
    registerEngineTrack: vi.fn((track: Track) => track.path || track.id),
    unregisterEngineTrack: vi.fn(),
    resetEngineTrackMap: vi.fn(),
    rememberActiveTrack: vi.fn(),
    startTrackerSession: vi.fn(),
    flushCurrentPlayEvent: vi.fn(),
    markSeekPosition: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    cancelRestoreAutoplay: vi.fn(),
    resetPlaybackIntelligence: vi.fn(),
    continueInfinitePlayback: vi.fn(() => false),
    clearPrevRestartLatch: vi.fn(),
    ensureJamQueueLocked: vi.fn(),
    commitQueue: vi.fn(),
    commitCurrentIndex: vi.fn(),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    pullFromEngine: vi.fn(() => ({ resolvedTrack: TRACK })),
    pushToEngine: vi.fn(),
    advanceCursorTo: vi.fn(),
    publishConnectState: vi.fn(async () => undefined),
    playbackDeliveryPolicy: "original" as const,
  };
}

describe("usePlayerQueueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    castPauseMock.mockResolvedValue({ ok: true });
    castPlayMock.mockResolvedValue({ ok: true });
    castSeekMock.mockResolvedValue({ ok: true });
    castSetVolumeMock.mockResolvedValue({ ok: true });
    isCastSessionActiveMock.mockReturnValue(false);
    startCastSessionMock.mockResolvedValue({ ok: true });
    shouldUseAndroidNativePlayerMock.mockReturnValue(false);
    androidLoadQueueMock.mockResolvedValue(undefined);
    androidInsertTrackMock.mockResolvedValue(undefined);
    androidRemoveTrackMock.mockResolvedValue(undefined);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("forces a restart when playAll is invoked for the same queue/index", async () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.playAll([TRACK], 0, { type: "album", name: "Album" });

    await waitFor(() => {
      expect(gaplessPlayer.loadQueue).toHaveBeenCalledWith(
        ["/music/Artist/Album/01-track.flac"],
        0,
        { restartIfSameIndex: true },
      );
    });
    expect(params.commitIsBuffering).toHaveBeenCalledWith(false);
    expect(gaplessPlayer.play).toHaveBeenCalledTimes(1);
    expect(params.publishConnectState).toHaveBeenCalledWith({
      claimActive: true,
    });
  });

  it("keeps local queue mutations disabled while a Jam session owns playback", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.jamQueueLockedRef.current = true;
    const queuedTrack = { ...TRACK, id: "track-queued", title: "Queued" };
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.playAll([TRACK, queuedTrack], 0, {
      type: "album",
      name: "Album",
    });
    result.current.addToQueue(queuedTrack);
    result.current.removeFromQueue(0);
    result.current.reorderQueue(0, 1);
    result.current.playNext(queuedTrack);
    result.current.jumpTo(0);
    result.current.next();

    expect(params.commitQueue).not.toHaveBeenCalled();
    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
    expect(gaplessPlayer.addTrack).not.toHaveBeenCalled();
    expect(gaplessPlayer.removeTrack).not.toHaveBeenCalled();
  });

  it("pushes authoritative Jam queue updates into the local player", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.jamQueueLockedRef.current = true;
    const queuedTrack = { ...TRACK, id: "track-queued", title: "Queued" };
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK, queuedTrack], {
      currentTrack: TRACK,
      playing: false,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.pushToEngine).toHaveBeenCalledWith([TRACK, queuedTrack], 0, {
      autoplay: false,
      positionMs: 0,
      preservePlayback: true,
    });
    expect(params.setPlaySource).toHaveBeenCalledWith({
      type: "queue",
      name: "Jam: Test",
    });
  });

  it("updates a room queue in place without rebuilding the active track", () => {
    const params = createParams();
    const queuedTrack = { ...TRACK, id: "track-queued", title: "Queued" };
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK, queuedTrack], {
      currentTrack: TRACK,
      positionSeconds: 42,
      playing: true,
      queueOnly: true,
      source: { type: "queue", name: "Jam: Test" },
    } as Parameters<typeof result.current.syncJamQueue>[1]);

    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
    expect(gaplessPlayer.insertTrack).toHaveBeenCalledTimes(1);
    expect(params.commitQueue).toHaveBeenCalledWith([TRACK, queuedTrack]);
  });

  it("applies transport position after updating a Jam queue in place", () => {
    const queuedTrack = { ...TRACK, id: "track-queued", title: "Queued" };
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK, queuedTrack], {
      currentTrack: TRACK,
      positionSeconds: 42.25,
      playing: true,
      queueOnly: true,
      forcePosition: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(gaplessPlayer.insertTrack).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.seekTo).toHaveBeenCalledWith(42_250);
  });

  it("does not let an older native Jam queue mutation append after a newer snapshot", async () => {
    shouldUseAndroidNativePlayerMock.mockReturnValue(true);
    const params = createParams();
    const queuedTrack = {
      ...TRACK,
      id: "track-queued",
      title: "Queued",
      path: "/music/Artist/Album/02-queued.flac",
    };
    const newerTrack = {
      ...TRACK,
      id: "track-newer",
      title: "Newer",
      path: "/music/Artist/Album/03-newer.flac",
    };
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    params.commitQueue.mockImplementation((queue: Track[]) => {
      params.queueRef.current = queue;
    });
    let releaseFirstInsert!: () => void;
    const firstInsert = new Promise<void>((resolve) => {
      releaseFirstInsert = resolve;
    });
    androidInsertTrackMock
      .mockImplementationOnce(() => firstInsert)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK, queuedTrack], {
      currentTrack: TRACK,
      playing: true,
      queueOnly: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    await waitFor(() =>
      expect(androidInsertTrackMock).toHaveBeenCalledTimes(1),
    );

    result.current.syncJamQueue([TRACK, newerTrack], {
      currentTrack: TRACK,
      playing: true,
      queueOnly: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    releaseFirstInsert();
    await waitFor(() => expect(androidRemoveTrackMock).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(androidInsertTrackMock).toHaveBeenCalledTimes(2),
    );
    expect(androidRemoveTrackMock).toHaveBeenCalledWith(1);
  });

  it("does not rebuild an unchanged Jam queue on repeated room state syncs", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 0;
    params.isPlayingRef.current = false;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));
    result.current.syncJamQueue([TRACK], {
      currentTrack: TRACK,
      positionSeconds: 0,
      playing: false,
      source: { type: "queue", name: "Jam: Test" },
    });
    result.current.syncJamQueue([{ ...TRACK }], {
      currentTrack: TRACK,
      positionSeconds: 0,
      playing: false,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
    expect(params.commitQueue).not.toHaveBeenCalled();
    expect(params.commitCurrentIndex).not.toHaveBeenCalled();
    expect(params.setPlaySource).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild a Jam queue when the snapshot uses another stable track id", () => {
    const localCurrent = {
      ...TRACK,
      id: "local-track-1",
      entityUid: "track-1",
      path: "/music/local-current.flac",
    };
    const localNext = {
      ...TRACK,
      id: "local-track-2",
      entityUid: "track-2",
      path: "/music/local-next.flac",
      title: "Next",
    };
    const roomCurrent = {
      ...localCurrent,
      id: "room-track-1",
      path: "/music/room-current.flac",
    };
    const roomNext = {
      ...localNext,
      id: "room-track-2",
      path: "/music/room-next.flac",
    };
    const params = createParams();
    params.queueRef.current = [localCurrent, localNext];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([roomCurrent, roomNext], {
      currentTrack: roomCurrent,
      playing: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
  });

  it("preserves the active playback position when a Jam queue is reordered", () => {
    const queuedTrack = {
      ...TRACK,
      id: "track-queued",
      title: "Queued",
      entityUid: "queued-entity",
      path: "/music/Artist/Album/02-queued.flac",
    };
    const params = createParams();
    params.queueRef.current = [TRACK, queuedTrack];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([queuedTrack, TRACK], {
      currentTrack: TRACK,
      playing: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.pushToEngine).toHaveBeenCalledWith([queuedTrack, TRACK], 1, {
      autoplay: true,
      positionMs: 42_000,
      preservePlayback: true,
    });
  });

  it("honors an explicit Jam sync for sub-second drift", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK], {
      currentTrack: TRACK,
      positionSeconds: 42.25,
      playing: true,
      forcePosition: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(gaplessPlayer.seekTo).toHaveBeenCalledWith(42_250);
  });

  it("honors an explicit Jam sync for a small audible drift", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK], {
      currentTrack: TRACK,
      positionSeconds: 42.03,
      playing: true,
      forcePosition: true,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(gaplessPlayer.seekTo).toHaveBeenCalledWith(42_030);
  });

  it("does not reload an empty Jam queue when the room has no active track", () => {
    const params = createParams();
    params.queueRef.current = [];
    params.currentIndexRef.current = 0;
    params.currentTimeRef.current = 0;
    params.isPlayingRef.current = false;
    params.jamQueueLockedRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([], {
      currentTrack: null,
      positionSeconds: 0,
      playing: false,
      source: { type: "queue", name: "Jam: Empty" },
    });
    result.current.syncJamQueue([], {
      currentTrack: null,
      positionSeconds: 0,
      playing: false,
      source: { type: "queue", name: "Jam: Empty" },
    });

    expect(params.pushToEngine).not.toHaveBeenCalled();
    expect(params.commitQueue).not.toHaveBeenCalled();
    expect(params.setPlaySource).toHaveBeenCalledTimes(1);
  });

  it("activates the Jam lock before applying an inbound room queue", () => {
    const params = createParams();
    params.ensureJamQueueLocked.mockImplementation(() => {
      params.jamQueueLockedRef.current = true;
    });
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.syncJamQueue([TRACK], {
      currentTrack: TRACK,
      source: { type: "queue", name: "Jam: Test" },
    });

    expect(params.ensureJamQueueLocked).toHaveBeenCalledTimes(1);
    expect(params.pushToEngine).toHaveBeenCalledWith([TRACK], 0, {
      autoplay: false,
      positionMs: 0,
      preservePlayback: true,
    });
  });

  it("does not claim Crate Connect ownership for queue mutation actions", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    const queuedTrack = { ...TRACK, id: "track-queued", title: "Queued" };
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.playNext(queuedTrack);
    result.current.addToQueue(queuedTrack);

    expect(params.publishConnectState).not.toHaveBeenCalled();
    expect(gaplessPlayer.insertTrack).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.addTrack).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.play).not.toHaveBeenCalled();
  });

  it("pauses immediately when the app is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.pause();

    expect(gaplessPlayer.pause).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
  });

  it("resumes immediately when the app is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.resume();

    expect(gaplessPlayer.restoreVolume).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.play).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();
  });

  it("routes transport and volume actions to an active Cast receiver", () => {
    isCastSessionActiveMock.mockReturnValue(true);
    const params = createParams();
    params.queueRef.current = [
      TRACK,
      { ...TRACK, id: "track-2", title: "Track Two" },
    ];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.pause();
    result.current.resume();
    result.current.seek(42);
    result.current.setVolume(0.6);
    result.current.next();

    expect(castPauseMock).toHaveBeenCalledTimes(1);
    expect(castPlayMock).toHaveBeenCalledTimes(1);
    expect(castSeekMock).toHaveBeenCalledWith(42);
    expect(castSetVolumeMock).toHaveBeenCalledWith(0.6);
    expect(startCastSessionMock).toHaveBeenCalledWith({
      track: expect.objectContaining({ id: "track-2" }),
      currentTime: 0,
    });
    expect(gaplessPlayer.play).not.toHaveBeenCalled();
    expect(gaplessPlayer.pause).not.toHaveBeenCalled();
    expect(gaplessPlayer.seekTo).not.toHaveBeenCalled();
    expect(params.commitIsPlaying).toHaveBeenCalledWith(false);
    expect(params.commitIsPlaying).toHaveBeenCalledWith(true);
  });
});
