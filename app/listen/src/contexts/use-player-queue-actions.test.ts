import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  castPauseMock,
  castPlayMock,
  castSeekMock,
  castSetVolumeMock,
  isCastSessionActiveMock,
  startCastSessionMock,
} = vi.hoisted(() => ({
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
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("forces a restart when playAll is invoked for the same queue/index", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.playAll([TRACK], 0, { type: "album", name: "Album" });

    expect(gaplessPlayer.loadQueue).toHaveBeenCalledWith(
      ["/music/Artist/Album/01-track.flac"],
      0,
      { restartIfSameIndex: true },
    );
    expect(params.commitIsBuffering).toHaveBeenCalledWith(false);
    expect(gaplessPlayer.play).toHaveBeenCalledTimes(1);
    expect(params.publishConnectState).toHaveBeenCalledWith({
      claimActive: true,
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
