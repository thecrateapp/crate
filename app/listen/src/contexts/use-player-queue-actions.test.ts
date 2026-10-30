import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  androidLoadQueueMock,
  androidInsertTrackMock,
  androidRemoveTrackMock,
  shouldUseAndroidNativePlayerMock,
  castPauseMock,
  castPlayMock,
  castQueueNextMock,
  castSeekMock,
  castSetVolumeMock,
  cancelNativeMediaSessionResumeMock,
  markNativeMediaSessionPlayingIntentMock,
  isCastSessionActiveMock,
  isCustomCastSessionActiveMock,
  startCastSessionMock,
  syncCustomCastQueueMock,
} = vi.hoisted(() => ({
  androidLoadQueueMock: vi.fn(),
  androidInsertTrackMock: vi.fn(),
  androidRemoveTrackMock: vi.fn(),
  shouldUseAndroidNativePlayerMock: vi.fn(() => false),
  castPauseMock: vi.fn(),
  castPlayMock: vi.fn(),
  castQueueNextMock: vi.fn(),
  castSeekMock: vi.fn(),
  castSetVolumeMock: vi.fn(),
  cancelNativeMediaSessionResumeMock: vi.fn(async () => {}),
  markNativeMediaSessionPlayingIntentMock: vi.fn(),
  isCastSessionActiveMock: vi.fn(),
  isCustomCastSessionActiveMock: vi.fn(),
  startCastSessionMock: vi.fn(),
  syncCustomCastQueueMock: vi.fn(),
}));

import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import { usePlayerTrackRecovery } from "@/contexts/use-player-track-recovery";
import type { PlaybackQueueReadiness } from "@/contexts/playback-intelligence-model";
import type { PlaySource, Track } from "@/contexts/player-types";
import * as gaplessPlayer from "@/lib/gapless-player";
import {
  toStartupEngineTracks,
  toStartupEngineQueueSnapshot,
} from "@/contexts/player-engine-adapter";

vi.mock("@/contexts/player-engine-adapter", () => ({
  toFreshEngineTrack: vi.fn(async (track: Track) => ({
    url: track.path || track.id,
  })),
  toStartupEngineQueueSnapshot: vi.fn(),
  toStartupEngineTracks: vi.fn(async (tracks: Track[]) =>
    tracks.map((track) => ({ url: track.path || track.id })),
  ),
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: {
    insertTrack: androidInsertTrackMock,
    loadQueue: androidLoadQueueMock,
    setContinuationContext: vi.fn().mockResolvedValue(undefined),
    removeTrack: androidRemoveTrackMock,
    stop: vi.fn(),
  },
  isAndroidNativePlayerAvailable: vi.fn(() => false),
  shouldUseAndroidNativePlayer: shouldUseAndroidNativePlayerMock,
}));

vi.mock("@/lib/gapless-player", () => ({
  addTrack: vi.fn(),
  fadeInAndPlay: vi.fn(),
  fadeOutAndPause: vi.fn(async () => {}),
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
  castQueueJumpTo: vi.fn(),
  castQueueNext: castQueueNextMock,
  castQueuePrevious: vi.fn(),
  castSeek: castSeekMock,
  castSetVolume: castSetVolumeMock,
  castStop: vi.fn(),
  isCastSessionActive: isCastSessionActiveMock,
  isCustomCastSessionActive: isCustomCastSessionActiveMock,
  startCastSession: startCastSessionMock,
  syncCustomCastQueue: syncCustomCastQueueMock,
}));

vi.mock("@/lib/native-media-session", () => ({
  cancelNativeMediaSessionResume: cancelNativeMediaSessionResumeMock,
  markNativeMediaSessionPlayingIntent: markNativeMediaSessionPlayingIntentMock,
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
  it.each(["prev", "jumpTo"] as const)(
    "wakes refill with a user gesture after %s selects another track",
    (action) => {
      const resumePlaybackIntelligence = vi.fn(() => false);
      const params = { ...createParams(), resumePlaybackIntelligence };
      params.queueRef.current = [TRACK, { ...TRACK, id: "track-2" }];
      params.currentIndexRef.current = 1;
      params.advanceCursorTo.mockImplementation((index: number) => {
        params.currentIndexRef.current = index;
      });
      const { result } = renderHook(() => usePlayerQueueActions(params));
      act(() => {
        if (action === "jumpTo") result.current.jumpTo(0);
        else result.current.prev();
      });
      expect(params.currentIndexRef.current).toBe(0);
      expect(resumePlaybackIntelligence).toHaveBeenCalledWith({
        userGesture: true,
      });
      expect(params.resetPlaybackIntelligence).not.toHaveBeenCalled();
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toStartupEngineTracks)
      .mockReset()
      .mockImplementation(async (tracks) =>
        tracks.map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          url: track.path || track.id,
        })),
      );
    castPauseMock.mockResolvedValue({ ok: true });
    castPlayMock.mockResolvedValue({ ok: true });
    castSeekMock.mockResolvedValue({ ok: true });
    castSetVolumeMock.mockResolvedValue({ ok: true });
    castQueueNextMock.mockResolvedValue({ ok: true });
    isCastSessionActiveMock.mockReturnValue(false);
    isCustomCastSessionActiveMock.mockReturnValue(false);
    startCastSessionMock.mockResolvedValue({ ok: true });
    syncCustomCastQueueMock.mockResolvedValue({ ok: true });
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

  it("keeps the replacement queue unready until URLs and the engine are installed", async () => {
    let resolve!: (
      tracks: Awaited<ReturnType<typeof toStartupEngineTracks>>,
    ) => void;
    vi.mocked(toStartupEngineTracks).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const queueReadinessRef = { current: { ready: true, generation: 0 } };
    const params = {
      ...createParams(),
      queueReadinessRef,
      resumePlaybackIntelligence: vi.fn(),
    };
    params.queueRef.current = [TRACK];
    params.isPlayingRef.current = true;
    params.commitQueue.mockImplementation((tracks) => {
      params.queueRef.current = tracks;
    });
    const replacement = { ...TRACK, id: "B", title: "B" };
    const { result } = renderHook(() => usePlayerQueueActions(params));
    act(() =>
      result.current.playAll([replacement], 0, { type: "album", name: "B" }),
    );
    expect(queueReadinessRef.current.ready).toBe(false);
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
    await act(async () => {
      resolve([{ id: "B", url: "B", title: "B", artist: "Artist" }]);
    });
    expect(queueReadinessRef.current.ready).toBe(true);
    expect(params.queueRef.current).toEqual([replacement]);
    expect(params.resumePlaybackIntelligence).toHaveBeenCalled();
  });

  it.each(["pause", "replace", "clear"])(
    "does not activate an obsolete URL preparation after %s",
    async (action) => {
      let resolve!: (
        tracks: Awaited<ReturnType<typeof toStartupEngineTracks>>,
      ) => void;
      vi.mocked(toStartupEngineTracks).mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const params = createParams();
      const { result } = renderHook(() => usePlayerQueueActions(params));
      act(() =>
        result.current.playAll([TRACK], 0, { type: "album", name: "B" }),
      );
      if (action === "pause") act(() => result.current.pause());
      else if (action === "clear") act(() => result.current.clearQueue());
      else
        act(() =>
          result.current.playAll([{ ...TRACK, id: "C" }], 0, {
            type: "album",
            name: "C",
          }),
        );
      await act(async () => {});
      const priorLoads = vi.mocked(gaplessPlayer.loadQueue).mock.calls.length;
      const priorPlays = vi.mocked(gaplessPlayer.play).mock.calls.length;
      await act(async () => {
        resolve([{ id: "B", url: "B", title: "B", artist: "Artist" }]);
      });
      expect(gaplessPlayer.loadQueue).toHaveBeenCalledTimes(priorLoads);
      expect(gaplessPlayer.play).toHaveBeenCalledTimes(priorPlays);
    },
  );

  it("restarts a cancelled preparation on explicit Resume without playing the previous engine queue", async () => {
    let resolve!: (
      tracks: Awaited<ReturnType<typeof toStartupEngineTracks>>,
    ) => void;
    vi.mocked(toStartupEngineTracks).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));
    act(() =>
      result.current.playAll([{ ...TRACK, id: "B" }], 0, {
        type: "album",
        name: "B",
      }),
    );
    act(() => result.current.pause());
    act(() => result.current.resume());
    await act(async () => {});
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledOnce();
    expect(gaplessPlayer.play).toHaveBeenCalledOnce();
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();
    await act(async () => {
      resolve([{ id: "B", url: "B", title: "B", artist: "Artist" }]);
    });
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledOnce();
    expect(gaplessPlayer.play).toHaveBeenCalledOnce();
  });

  it("recovers the preparation barrier after Pause cancels ticket recovery and Resume renews the current queue", async () => {
    let resolveOldTickets!: (
      tracks: Awaited<ReturnType<typeof toStartupEngineTracks>>,
    ) => void;
    vi.mocked(toStartupEngineTracks)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldTickets = resolve;
          }),
      )
      .mockResolvedValueOnce([
        {
          id: TRACK.id,
          url: "/stream/current?media_ticket=renewed-after-resume",
          title: TRACK.title,
          artist: TRACK.artist,
        },
      ]);
    vi.mocked(gaplessPlayer.fadeInAndPlay).mockResolvedValue("applied");
    const queueReadinessRef: { current: PlaybackQueueReadiness } = {
      current: { ready: true, generation: 4 },
    };
    const params = {
      ...createParams(),
      queueReadinessRef,
      playSourceRef: {
        current: { type: "album", name: "Album" } as PlaySource | null,
      },
      buildEngineUrls: vi.fn((tracks: Track[], urls?: string[]) =>
        tracks.map((track, index) => urls?.[index] ?? track.path ?? track.id),
      ),
      resumePlaybackIntelligence: vi.fn(),
    };
    params.queueRef.current = [TRACK];
    params.isPlayingRef.current = true;
    const { result } = renderHook(() => ({
      recovery: usePlayerTrackRecovery({
        ...params,
        effectiveCrossfadeMsRef: { current: 0 },
      }),
      actions: usePlayerQueueActions(params),
    }));
    const recovery = result.current.recovery.recoverActiveTrackRef.current();
    expect(queueReadinessRef.current.ready).toBe(false);

    act(() => result.current.actions.pause({ immediate: true }));
    await act(async () => {
      resolveOldTickets([
        {
          id: TRACK.id,
          url: "/stream/current?media_ticket=cancelled-recovery",
          title: TRACK.title,
          artist: TRACK.artist,
        },
      ]);
      expect(await recovery).toBe(false);
    });
    expect(gaplessPlayer.loadQueue).not.toHaveBeenCalled();
    expect(gaplessPlayer.play).not.toHaveBeenCalled();
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();

    await act(async () => result.current.actions.resume());

    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledWith(
      ["/stream/current?media_ticket=renewed-after-resume"],
      0,
      expect.any(Object),
    );
    expect(gaplessPlayer.play).toHaveBeenCalledOnce();
    expect(queueReadinessRef.current.ready).toBe(true);
    expect(params.resumePlaybackIntelligence).toHaveBeenCalledWith({
      userGesture: true,
    });
  });

  it("lets Resume's fresh recovery finish before the cancelled recovery without changing its queue or position", async () => {
    type EngineTracks = Awaited<ReturnType<typeof toStartupEngineTracks>>;
    let resolveOld!: (tracks: EngineTracks) => void;
    let resolveNew!: (tracks: EngineTracks) => void;
    const oldTickets = new Promise<EngineTracks>((resolve) => {
      resolveOld = resolve;
    });
    const newTickets = new Promise<EngineTracks>((resolve) => {
      resolveNew = resolve;
    });
    vi.mocked(toStartupEngineTracks)
      .mockReturnValueOnce(oldTickets)
      .mockReturnValueOnce(newTickets);
    vi.mocked(gaplessPlayer.fadeInAndPlay).mockResolvedValue("applied");
    const queueReadinessRef: { current: PlaybackQueueReadiness } = {
      current: { ready: true, generation: 4 },
    };
    const source: PlaySource = { type: "album", name: "Album" };
    const queue = [TRACK];
    const params = {
      ...createParams(),
      queueReadinessRef,
      playSourceRef: { current: source as PlaySource | null },
      buildEngineUrls: vi.fn((tracks: Track[], urls?: string[]) =>
        tracks.map((track, index) => urls?.[index] ?? track.path ?? track.id),
      ),
      resumePlaybackIntelligence: vi.fn(),
    };
    params.queueRef.current = queue;
    params.currentTimeRef.current = 42;
    params.isPlayingRef.current = true;
    const { result } = renderHook(() => ({
      recovery: usePlayerTrackRecovery({
        ...params,
        effectiveCrossfadeMsRef: { current: 0 },
      }),
      actions: usePlayerQueueActions(params),
    }));
    const obsoleteRecovery =
      result.current.recovery.recoverActiveTrackRef.current();
    act(() => result.current.actions.pause({ immediate: true }));
    const cancelledGeneration = queueReadinessRef.current.generation;
    act(() => result.current.actions.resume());
    const engineTrack = {
      id: TRACK.id,
      title: TRACK.title,
      artist: TRACK.artist,
      url: "/stream/current?media_ticket=resume-winner",
    };
    await act(async () => resolveNew([engineTrack]));
    const winnerReadiness = { ...queueReadinessRef.current };
    const winnerLoadCount = vi.mocked(gaplessPlayer.loadQueue).mock.calls
      .length;
    const winnerPlayCount = vi.mocked(gaplessPlayer.play).mock.calls.length;

    await act(async () => {
      resolveOld([
        { ...engineTrack, url: "/stream/current?media_ticket=cancelled-old" },
      ]);
      expect(await obsoleteRecovery).toBe(false);
    });

    expect(winnerReadiness.ready).toBe(true);
    expect(winnerReadiness.generation).toBeGreaterThan(cancelledGeneration);
    expect(queueReadinessRef.current).toEqual(winnerReadiness);
    expect(winnerLoadCount).toBe(1);
    expect(winnerPlayCount).toBe(1);
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledExactlyOnceWith(
      [engineTrack.url],
      0,
      expect.any(Object),
    );
    expect(gaplessPlayer.seekTo).toHaveBeenCalledExactlyOnceWith(42_000);
    expect(gaplessPlayer.play).toHaveBeenCalledOnce();
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();
    expect(params.queueRef.current).toBe(queue);
    expect(params.currentIndexRef.current).toBe(0);
    expect(params.currentTimeRef.current).toBe(42);
    expect(params.playSourceRef.current).toBe(source);
  });

  it("does not wake refill when Pause arrives after Resume installed its queue but before play resolves", async () => {
    type EngineTracks = Awaited<ReturnType<typeof toStartupEngineTracks>>;
    let resolveOld!: (tracks: EngineTracks) => void;
    const oldTickets = new Promise<EngineTracks>((resolve) => {
      resolveOld = resolve;
    });
    const freshTrack = {
      id: TRACK.id,
      title: TRACK.title,
      artist: TRACK.artist,
      url: "/stream/current?media_ticket=play-pending",
    };
    vi.mocked(toStartupEngineTracks)
      .mockReturnValueOnce(oldTickets)
      .mockResolvedValueOnce([freshTrack]);
    const queueReadinessRef: { current: PlaybackQueueReadiness } = {
      current: { ready: true, generation: 4 },
    };
    const params = {
      ...createParams(),
      queueReadinessRef,
      playSourceRef: {
        current: { type: "album", name: "Album" } as PlaySource | null,
      },
      buildEngineUrls: vi.fn((tracks: Track[], urls?: string[]) =>
        tracks.map((track, index) => urls?.[index] ?? track.path ?? track.id),
      ),
      resumePlaybackIntelligence: vi.fn(),
    };
    params.queueRef.current = [TRACK];
    params.isPlayingRef.current = true;
    params.commitIsPlaying.mockImplementation((playing: boolean) => {
      params.isPlayingRef.current = playing;
    });
    vi.mocked(gaplessPlayer.pause)
      .mockImplementationOnce(() => params.commitIsPlaying(false))
      .mockImplementationOnce(() => params.commitIsPlaying(false));
    let completePlay!: (
      outcome: Awaited<ReturnType<typeof gaplessPlayer.play>>,
    ) => void;
    const playAccepted = new Promise<
      Awaited<ReturnType<typeof gaplessPlayer.play>>
    >((resolve) => {
      completePlay = resolve;
    });
    vi.mocked(gaplessPlayer.play).mockImplementationOnce(() => {
      params.commitIsPlaying(true);
      return playAccepted;
    });
    const { result } = renderHook(() => ({
      recovery: usePlayerTrackRecovery({
        ...params,
        effectiveCrossfadeMsRef: { current: 0 },
      }),
      actions: usePlayerQueueActions(params),
    }));
    const obsoleteRecovery =
      result.current.recovery.recoverActiveTrackRef.current();
    act(() => result.current.actions.pause({ immediate: true }));
    await act(async () => result.current.actions.resume());
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledOnce();
    expect(queueReadinessRef.current.ready).toBe(true);
    const installedGeneration = queueReadinessRef.current.generation;
    const resumesBeforePause =
      params.resumePlaybackIntelligence.mock.calls.length;

    act(() => result.current.actions.pause({ immediate: true }));
    expect(params.isPlayingRef.current).toBe(false);
    expect(queueReadinessRef.current.generation).toBe(installedGeneration);
    await act(async () => {
      completePlay("applied");
      resolveOld([
        { ...freshTrack, url: "/stream/current?media_ticket=cancelled-old" },
      ]);
      expect(await obsoleteRecovery).toBe(false);
    });

    expect(params.resumePlaybackIntelligence).toHaveBeenCalledTimes(
      resumesBeforePause,
    );
    expect(params.isPlayingRef.current).toBe(false);
    expect(queueReadinessRef.current.ready).toBe(true);
    expect(queueReadinessRef.current.generation).toBe(installedGeneration);
    expect(gaplessPlayer.loadQueue).toHaveBeenCalledOnce();
    expect(gaplessPlayer.play).toHaveBeenCalledOnce();
  });

  it("waits for the native queue ACK before declaring a replacement ready", async () => {
    shouldUseAndroidNativePlayerMock.mockReturnValue(true);
    let resolveSnapshot!: (
      value: Awaited<ReturnType<typeof toStartupEngineQueueSnapshot>>,
    ) => void;
    let resolveLoad!: (value: undefined) => void;
    vi.mocked(toStartupEngineQueueSnapshot).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveSnapshot = done;
        }),
    );
    androidLoadQueueMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveLoad = done;
        }),
    );
    const queueReadinessRef = { current: { ready: true, generation: 0 } };
    const params = {
      ...createParams(),
      queueReadinessRef,
      resumePlaybackIntelligence: vi.fn(),
    };
    params.isPlayingRef.current = true;
    const { result } = renderHook(() => usePlayerQueueActions(params));
    act(() => result.current.playAll([TRACK], 0, { type: "album", name: "B" }));
    expect(queueReadinessRef.current.ready).toBe(false);
    expect(androidLoadQueueMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveSnapshot({
        revision: "B",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: true,
        repeat: "off",
        crossfadeMs: 0,
        volume: 1,
      });
    });
    expect(androidLoadQueueMock).toHaveBeenCalledOnce();
    expect(queueReadinessRef.current.ready).toBe(false);
    expect(params.resumePlaybackIntelligence).not.toHaveBeenCalled();
    await act(async () => {
      resolveLoad(undefined);
    });
    expect(queueReadinessRef.current.ready).toBe(true);
    expect(params.resumePlaybackIntelligence).toHaveBeenCalledOnce();
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

  it("mutates a custom Cast queue without touching the local engine", async () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    isCastSessionActiveMock.mockReturnValue(true);
    isCustomCastSessionActiveMock.mockReturnValue(true);
    const queuedTrack = { ...TRACK, id: "track-queued", libraryTrackId: 22 };
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.addToQueue(queuedTrack);

    await waitFor(() =>
      expect(syncCustomCastQueueMock).toHaveBeenCalledWith({
        queue: [TRACK, queuedTrack],
        currentIndex: 0,
        repeatMode: "off",
        shuffle: false,
      }),
    );
    expect(params.commitQueue).toHaveBeenCalledWith([TRACK, queuedTrack]);
    expect(gaplessPlayer.addTrack).not.toHaveBeenCalled();
    expect(params.registerEngineTrack).not.toHaveBeenCalled();
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

  it("uses immediate engine pause only when explicitly requested", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));
    const pause = result.current.pause as (options?: {
      immediate?: boolean;
    }) => void;

    pause();

    expect(gaplessPlayer.fadeOutAndPause).toHaveBeenCalledWith(220);
    expect(gaplessPlayer.pause).not.toHaveBeenCalled();

    vi.clearAllMocks();
    pause({ immediate: true });

    expect(gaplessPlayer.pause).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
  });

  it("cancels a pending native resume even when playback is already paused", () => {
    const params = createParams();
    params.isPlayingRef.current = false;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.pause();

    expect(cancelNativeMediaSessionResumeMock).toHaveBeenCalledTimes(1);
  });

  it("preserves native resume only for the interruption-originated pause", () => {
    const params = createParams();
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.pause({ preserveNativeResume: true });

    expect(cancelNativeMediaSessionResumeMock).not.toHaveBeenCalled();
  });

  it("restores native resume permission for an explicit resume", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.resume();

    expect(markNativeMediaSessionPlayingIntentMock).toHaveBeenCalledTimes(1);
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

  it("routes transport and volume actions to an active Cast receiver", async () => {
    isCastSessionActiveMock.mockReturnValue(true);
    isCustomCastSessionActiveMock.mockReturnValue(true);
    castQueueNextMock.mockResolvedValue({ ok: true });
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
    expect(castQueueNextMock).toHaveBeenCalledTimes(1);
    expect(startCastSessionMock).not.toHaveBeenCalled();
    expect(gaplessPlayer.play).not.toHaveBeenCalled();
    expect(gaplessPlayer.pause).not.toHaveBeenCalled();
    expect(gaplessPlayer.seekTo).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(params.commitIsPlaying).toHaveBeenCalledWith(false);
      expect(params.commitIsPlaying).toHaveBeenCalledWith(true);
      expect(params.advanceCursorTo).not.toHaveBeenCalled();
    });
  });

  it("keeps local player state unchanged when Cast rejects commands", async () => {
    isCastSessionActiveMock.mockReturnValue(true);
    isCustomCastSessionActiveMock.mockReturnValue(true);
    castPauseMock.mockResolvedValue({ ok: false, message: "pause rejected" });
    castPlayMock.mockResolvedValue({ ok: false, message: "play rejected" });
    castSeekMock.mockResolvedValue({ ok: false, message: "seek rejected" });
    castSetVolumeMock.mockResolvedValue({
      ok: false,
      message: "volume rejected",
    });
    castQueueNextMock.mockResolvedValue({
      ok: false,
      message: "queue rejected",
    });
    startCastSessionMock.mockResolvedValue({
      ok: false,
      message: "load rejected",
    });
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

    await waitFor(() => {
      expect(castQueueNextMock).toHaveBeenCalledTimes(1);
      expect(castSetVolumeMock).toHaveBeenCalledTimes(1);
    });
    expect(params.commitIsPlaying).not.toHaveBeenCalled();
    expect(params.commitCurrentTime).not.toHaveBeenCalled();
    expect(params.markSeekPosition).not.toHaveBeenCalled();
    expect(params.setVolumeState).not.toHaveBeenCalled();
    expect(params.advanceCursorTo).not.toHaveBeenCalled();
  });
});
