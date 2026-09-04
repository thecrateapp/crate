import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import type { PlaySource } from "@/contexts/player-types";
import {
  getTrackQualityFallback,
  getTrackQualityFromInfo,
  mergeTrackQualityParts,
} from "@/lib/track-info";
import {
  getTrackQualityFromPlaybackQuality,
  playbackResolutionShowsDeliveryQuality,
} from "@/lib/track-playback";
import {
  getPlaybackDeliveryPolicyPreference,
  getEffectivePlaybackDeliveryPolicy,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import { triggerHaptic } from "@/lib/haptics";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { useTrackPlayback } from "@/hooks/use-track-playback";
import { useTrackInfo } from "@/hooks/use-track-info";
import { cn } from "@crate/ui/lib/cn";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { toast } from "sonner";
import { PlayerBarTrackInfo } from "@/components/player/bar/PlayerBarTrackInfo";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import {
  LazyEqualizerPopover,
  LazyExtendedPlayer,
  LazyFullscreenPlayer,
  LazyLyricsPanel,
  LazyQueuePanel,
  preloadEqualizerPopover,
  preloadExtendedPlayer,
  preloadFullscreenPlayer,
  preloadLyricsPanel,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { PlayerBarTransportControls } from "@/components/player/bar/PlayerBarTransportControls";
import { PlayerBarActionButtons } from "@/components/player/bar/PlayerBarActionButtons";
import type { PlaybackTargetContext } from "@/lib/playback-targets";
import {
  CONNECT_SESSION_EVENT,
  CRATE_CONNECT_V2_TRANSPORT_ENABLED,
  fetchActiveConnectSnapshot,
  fetchConnectDevices,
  sendConnectCommand,
  type ActiveConnectSession,
} from "@/lib/crate-connect";
import { formatCrateDeviceName, getListenDeviceId } from "@/lib/listen-device";
import {
  remotePlaybackQueue,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";
import { getPlaySourceLabel } from "@/components/player/player-source";
import {
  getQualityBadge,
  shouldFetchTrackQualityInfo,
} from "@/components/player/bar/player-bar-utils";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";

const FS_OPEN_KEY = "listen-fs-player-open";
const SHOW_PLAYER_BAR_ANALYZER = true;

function getStoredFsOpen(): boolean {
  try {
    return localStorage.getItem(FS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function PlayerSurfaceFallback({
  fullscreen = false,
}: {
  fullscreen?: boolean;
}) {
  const { t } = useTranslation();
  if (!fullscreen) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-app-player-overlay flex justify-end px-4"
        style={{
          bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
        }}
      >
        <div className="listen-player-surface-fallback flex items-center gap-2 rounded-full px-3 py-2 text-[11px] backdrop-blur-xl">
          <Loader2
            size={CRATE_ICON_SIZE.sm}
            className="animate-spin text-accent-action"
          />
          {t("player.loading")}
        </div>
      </div>
    );
  }
  return (
    <div className="listen-player-fullscreen-scrim fixed inset-0 z-fullscreen-player flex items-center justify-center backdrop-blur-xl">
      <Loader2 size={24} className="animate-spin text-accent-action" />
    </div>
  );
}

export function PlayerBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    currentTime,
    duration,
    isPlaying,
    isBuffering,
    volume,
    analyserVersion,
    crossfadeTransition,
  } = usePlayer();
  const {
    currentTrack,
    jamQueueLocked,
    shuffle,
    repeat,
    playSource,
    queue,
    currentIndex,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    publishConnectState,
    connect,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerActions();
  const isDesktop = useIsDesktop();
  const connectEnabled = useCrateConnectEnabled();
  const legacyConnectEnabled =
    connectEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const equalizerEnabled = useEqualizerEnabled();
  const equalizerRuntimeAvailable =
    canUseWebAudioEffects || shouldUseAndroidNativePlayer();
  const allowEqualizer = equalizerEnabled && equalizerRuntimeAvailable;
  const showPlayerBarAnalyzer =
    SHOW_PLAYER_BAR_ANALYZER && isDesktop && equalizerRuntimeAvailable;
  const jamTransportDisabled = jamQueueLocked;

  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Crossfade still animates visual elements like artwork/title, but
  // the seek bar and timestamps should always reflect the active
  // incoming track's live playback state.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );

  const currentConnectDeviceId = useMemo(() => getListenDeviceId(), []);
  const [activeConnectSession, setActiveConnectSession] =
    useState<ActiveConnectSession | null>(null);
  const [activeConnectState, setActiveConnectState] =
    useState<RemotePlaybackState | null>(null);
  const [activeConnectStateFetchedAt, setActiveConnectStateFetchedAt] =
    useState<number | null>(null);
  const [activeConnectDeviceLabel, setActiveConnectDeviceLabel] = useState<
    string | null
  >(null);
  const [remoteClockTick, setRemoteClockTick] = useState(0);
  const [optimisticRemoteTime, setOptimisticRemoteTime] = useState<
    number | null
  >(null);
  const [optimisticRemoteVolume, setOptimisticRemoteVolume] = useState<
    number | null
  >(null);
  const coverLongPressTimerRef = useRef<number | null>(null);
  const coverLongPressTriggeredRef = useRef(false);
  const clearCoverLongPressTimer = useCallback(() => {
    if (coverLongPressTimerRef.current === null) return;
    window.clearTimeout(coverLongPressTimerRef.current);
    coverLongPressTimerRef.current = null;
  }, []);
  const activeConnectDeviceId = activeConnectSession?.active_device_id ?? null;
  const legacyRemoteConnectActive = Boolean(
    legacyConnectEnabled &&
      activeConnectDeviceId &&
      activeConnectDeviceId !== currentConnectDeviceId,
  );
  const v2RemoteConnectActive = Boolean(
    connect.transport === "ws" && connect.isRemoteActive && connect.remoteState,
  );
  const isRemoteConnectActive =
    legacyRemoteConnectActive || v2RemoteConnectActive;
  const remoteConnectState = v2RemoteConnectActive
    ? connect.remoteState
    : activeConnectState;
  const { frequenciesDb, sampleRate } = useAudioVisualizer(
    showPlayerBarAnalyzer && isPlaying && !isRemoteConnectActive,
    `${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
  );
  const activeConnectInstance =
    connect.transport === "ws"
      ? connect.connectedInstances.find(
          (instance) => instance.instance_id === connect.activeInstanceId,
        )
      : null;
  const remoteConnectDeviceLabel =
    isRemoteConnectActive && v2RemoteConnectActive
      ? formatCrateDeviceName({
          app_platform:
            activeConnectInstance?.app_platform ??
            connect.remoteState?.app_platform,
          device_label:
            activeConnectInstance?.device_label ??
            connect.remoteState?.device_label,
          device_type:
            activeConnectInstance?.device_type ??
            connect.remoteState?.device_type,
        })
      : isRemoteConnectActive
        ? activeConnectDeviceLabel
        : null;
  const effectiveIsPlaying = isRemoteConnectActive
    ? remoteConnectState?.status === "playing"
    : isPlaying;
  const remoteDuration =
    typeof remoteConnectState?.duration_ms === "number"
      ? remoteConnectState.duration_ms / 1000
      : 0;
  const remoteDisplayedTime = useMemo(() => {
    if (!isRemoteConnectActive || !remoteConnectState) return 0;
    if (optimisticRemoteTime !== null) return optimisticRemoteTime;
    const baseMs = Math.max(0, remoteConnectState.position_ms || 0);
    if (remoteConnectState.status !== "playing") return baseMs / 1000;
    if (v2RemoteConnectActive && remoteConnectState.position_updated_at) {
      const serverAnchor = Date.parse(remoteConnectState.position_updated_at);
      if (Number.isFinite(serverAnchor)) {
        const projected =
          baseMs +
          Math.max(0, Date.now() + connect.serverClockOffsetMs - serverAnchor);
        const durationMs = remoteConnectState.duration_ms || 0;
        return (
          (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000
        );
      }
    }
    if (activeConnectStateFetchedAt === null) return baseMs / 1000;
    const elapsedMs = Math.max(0, Date.now() - activeConnectStateFetchedAt);
    const projected = baseMs + elapsedMs;
    const durationMs = remoteConnectState.duration_ms || 0;
    return (
      (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000
    );
  }, [
    activeConnectStateFetchedAt,
    connect.serverClockOffsetMs,
    isRemoteConnectActive,
    optimisticRemoteTime,
    remoteConnectState,
    remoteClockTick,
    v2RemoteConnectActive,
  ]);
  const effectiveDisplayedTime = isRemoteConnectActive
    ? remoteDisplayedTime
    : displayedTime;
  const effectiveDisplayedDuration =
    isRemoteConnectActive && remoteDuration > 0
      ? remoteDuration
      : displayedDuration;
  const effectiveVolume =
    isRemoteConnectActive && optimisticRemoteVolume !== null
      ? optimisticRemoteVolume
      : volume;

  const refreshConnectSession = useCallback(() => {
    let cancelled = false;
    if (!legacyConnectEnabled) {
      setActiveConnectSession(null);
      setActiveConnectState(null);
      setActiveConnectStateFetchedAt(null);
      setActiveConnectDeviceLabel(null);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      fetchActiveConnectSnapshot().catch(() => ({
        session: null,
        state: null,
      })),
      fetchConnectDevices().catch(() => ({ devices: [] })),
    ]).then(([snapshot, devices]) => {
      if (cancelled) return;
      const session = snapshot.session;
      setActiveConnectSession(session);
      setActiveConnectState(snapshot.state ?? null);
      setActiveConnectStateFetchedAt(snapshot.state ? Date.now() : null);
      const activeDeviceId = session?.active_device_id;
      const activeDevice = devices.devices.find(
        (device) => device.device_id === activeDeviceId,
      );
      setActiveConnectDeviceLabel(
        activeDevice
          ? formatCrateDeviceName(activeDevice)
          : activeDeviceId
            ? "Crate device"
            : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [legacyConnectEnabled]);
  const refreshConnectSessionCleanupRef = useRef<(() => void) | null>(null);
  const runRefreshConnectSession = useCallback(() => {
    refreshConnectSessionCleanupRef.current?.();
    refreshConnectSessionCleanupRef.current = refreshConnectSession();
  }, [refreshConnectSession]);

  useEffect(() => {
    runRefreshConnectSession();
    return () => {
      refreshConnectSessionCleanupRef.current?.();
      refreshConnectSessionCleanupRef.current = null;
    };
  }, [runRefreshConnectSession]);

  useEffect(() => {
    window.addEventListener(CONNECT_SESSION_EVENT, runRefreshConnectSession);
    window.addEventListener("focus", runRefreshConnectSession);
    return () => {
      window.removeEventListener(
        CONNECT_SESSION_EVENT,
        runRefreshConnectSession,
      );
      window.removeEventListener("focus", runRefreshConnectSession);
    };
  }, [runRefreshConnectSession]);

  useEffect(() => {
    if (!isRemoteConnectActive) {
      setOptimisticRemoteTime(null);
      setOptimisticRemoteVolume(null);
    }
  }, [isRemoteConnectActive]);

  useEffect(() => {
    if (!isRemoteConnectActive || remoteConnectState?.status !== "playing")
      return;
    const intervalId = window.setInterval(() => {
      setRemoteClockTick((value) => value + 1);
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, remoteConnectState?.status]);

  useEffect(() => {
    if (!isRemoteConnectActive) return;
    const intervalId = window.setInterval(runRefreshConnectSession, 2500);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, runRefreshConnectSession]);

  useEffect(() => {
    setOptimisticRemoteTime(null);
    setOptimisticRemoteVolume(null);
  }, [
    activeConnectSession?.playback_session_id,
    activeConnectSession?.state_revision,
  ]);

  const sendRemoteTransportCommand = useCallback(
    async (
      type: "pause" | "resume" | "seek" | "next" | "previous" | "set_volume",
      payload?: Record<string, unknown>,
    ) => {
      if (v2RemoteConnectActive) {
        const wsType =
          type === "next"
            ? "next_track"
            : type === "previous"
              ? "previous_track"
              : type === "set_volume"
                ? "volume"
                : type;
        const ok = connect.sendRemoteCommand(wsType, payload);
        if (!ok) {
          toast.error(
            remoteConnectDeviceLabel
              ? `Could not control ${remoteConnectDeviceLabel}`
              : "Could not control remote device",
          );
        }
        return ok;
      }
      if (!isRemoteConnectActive || !activeConnectDeviceId) return false;
      try {
        await sendConnectCommand({
          type,
          targetDeviceId: activeConnectDeviceId,
          playbackSessionId: activeConnectSession?.playback_session_id,
          payload,
        });
        if (type === "pause" || type === "resume") {
          setActiveConnectSession((previous) =>
            previous
              ? {
                  ...previous,
                  status: type === "pause" ? "paused" : "playing",
                }
              : previous,
          );
        }
        window.setTimeout(runRefreshConnectSession, 600);
      } catch {
        toast.error(
          remoteConnectDeviceLabel
            ? `Could not control ${remoteConnectDeviceLabel}`
            : "Could not control remote device",
        );
        return false;
      }
      return true;
    },
    [
      activeConnectDeviceId,
      activeConnectSession?.playback_session_id,
      connect,
      isRemoteConnectActive,
      remoteConnectDeviceLabel,
      runRefreshConnectSession,
      v2RemoteConnectActive,
    ],
  );

  const handlePlayPause = useCallback(() => {
    triggerHaptic("light");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand(effectiveIsPlaying ? "pause" : "resume");
      return;
    }
    if (isPlaying) pause();
    else resume();
  }, [
    effectiveIsPlaying,
    isPlaying,
    jamQueueLocked,
    isRemoteConnectActive,
    pause,
    resume,
    sendRemoteTransportCommand,
  ]);

  const handlePreviousTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("previous");
      return;
    }
    prev();
  }, [isRemoteConnectActive, jamQueueLocked, prev, sendRemoteTransportCommand]);

  const handleNextTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("next");
      return;
    }
    next();
  }, [isRemoteConnectActive, jamQueueLocked, next, sendRemoteTransportCommand]);

  const handleSeek = useCallback(
    (time: number) => {
      if (jamQueueLocked) return;
      if (isRemoteConnectActive) {
        const nextTime =
          effectiveDisplayedDuration > 0
            ? Math.max(0, Math.min(time, effectiveDisplayedDuration))
            : Math.max(0, time);
        setOptimisticRemoteTime(nextTime);
        void sendRemoteTransportCommand("seek", {
          position_ms: Math.round(nextTime * 1000),
        }).then((ok) => {
          if (!ok) setOptimisticRemoteTime(null);
        });
        return;
      }
      seek(time);
    },
    [
      effectiveDisplayedDuration,
      jamQueueLocked,
      isRemoteConnectActive,
      seek,
      sendRemoteTransportCommand,
    ],
  );

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      if (isRemoteConnectActive) {
        const normalizedVolume = Math.max(0, Math.min(1, nextVolume));
        setOptimisticRemoteVolume(normalizedVolume);
        void sendRemoteTransportCommand("set_volume", {
          volume: normalizedVolume,
        }).then((ok) => {
          if (!ok) setOptimisticRemoteVolume(null);
        });
        return;
      }
      setVolume(nextVolume);
    },
    [isRemoteConnectActive, sendRemoteTransportCommand, setVolume],
  );

  const [seekHover, setSeekHover] = useState<{
    pct: number;
    time: string;
  } | null>(null);

  const [extendedOpen, setExtendedOpen] = useState(false);
  const [fsOpen, setFsOpenRaw] = useState(getStoredFsOpen);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [playbackDeliveryPolicy, setPlaybackDeliveryPolicy] =
    useState<PlaybackDeliveryPreference>(getPlaybackDeliveryPolicyPreference);
  const [shouldRenderQueuePanel, setShouldRenderQueuePanel] = useState(false);
  const [shouldRenderLyricsPanel, setShouldRenderLyricsPanel] = useState(false);
  const [shouldRenderEqualizerPopover, setShouldRenderEqualizerPopover] =
    useState(false);
  const [shouldRenderExtendedPlayer, setShouldRenderExtendedPlayer] =
    useState(false);
  const [shouldRenderFullscreenPlayer, setShouldRenderFullscreenPlayer] =
    useState(false);
  const [hasFloatingOverlayOpen, setHasFloatingOverlayOpen] = useState(false);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();

  useEffect(() => {
    if (!allowEqualizer) setShowEqualizer(false);
  }, [allowEqualizer]);

  const setFsOpen = useCallback((open: boolean) => {
    setFsOpenRaw(open);
    try {
      localStorage.setItem(FS_OPEN_KEY, String(open));
    } catch {
      /* ignore */
    }
  }, []);

  useDismissibleLayer({
    active: hasFloatingOverlayOpen || showQueue || showLyrics || showEqualizer,
    refs: [],
    onDismiss: () => {
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
    },
    closeOnPointerDownOutside: false,
  });

  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (fsOpen) return;
      if (
        !hasFloatingOverlayOpen &&
        !showQueue &&
        !showLyrics &&
        !showEqualizer &&
        !extendedOpen
      ) {
        return;
      }
      event.preventDefault();
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
      setExtendedOpen(false);
    };
    window.addEventListener("crate:native-back", handleNativeBack);
    return () =>
      window.removeEventListener("crate:native-back", handleNativeBack);
  }, [
    extendedOpen,
    fsOpen,
    hasFloatingOverlayOpen,
    showEqualizer,
    showLyrics,
    showQueue,
  ]);

  useEffect(() => {
    if (isDesktop) return;

    const closeMobileSurfaces = (event?: Event) => {
      if (
        event?.type === "visibilitychange" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "hidden"
      ) {
        return;
      }
      setFsOpen(false);
      setExtendedOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
      setHasFloatingOverlayOpen(false);
    };

    window.addEventListener(
      "crate:app-paused",
      closeMobileSurfaces as EventListener,
    );
    document.addEventListener("visibilitychange", closeMobileSurfaces);
    return () => {
      window.removeEventListener(
        "crate:app-paused",
        closeMobileSurfaces as EventListener,
      );
      document.removeEventListener("visibilitychange", closeMobileSurfaces);
    };
  }, [isDesktop, setFsOpen]);

  useEffect(() => {
    if (!isRemoteConnectActive) return;
    setFsOpen(false);
    setExtendedOpen(false);
    setShowLyrics(false);
    setShowEqualizer(false);
    setHasFloatingOverlayOpen(false);
  }, [isRemoteConnectActive, setFsOpen]);

  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const nextPolicy = (
        event as CustomEvent<{
          playbackDeliveryPolicy?: PlaybackDeliveryPreference;
        }>
      ).detail?.playbackDeliveryPolicy;
      setPlaybackDeliveryPolicy(
        nextPolicy ?? getPlaybackDeliveryPolicyPreference(),
      );
    };
    window.addEventListener(
      PLAYER_PLAYBACK_PREFS_EVENT,
      onPrefsChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        PLAYER_PLAYBACK_PREFS_EVENT,
        onPrefsChanged as EventListener,
      );
    };
  }, []);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    if (!t) return;
    const deltaX = t.clientX - touchStartX.current;
    const deltaY = t.clientY - touchStartY.current;
    const action = getHorizontalPlayerSwipeAction({
      deltaX,
      deltaY,
      viewportWidth: window.innerWidth,
    });
    if (action === "next") {
      handleNextTrack();
    } else if (action === "previous") {
      handlePreviousTrack();
    }
  }

  const remoteDisplayQueue = useMemo(
    () => (remoteConnectState ? remotePlaybackQueue(remoteConnectState) : []),
    [remoteConnectState],
  );
  const remoteDisplayIndex =
    remoteDisplayQueue.length > 0
      ? Math.max(
          0,
          Math.min(
            remoteConnectState?.current_index ?? 0,
            remoteDisplayQueue.length - 1,
          ),
        )
      : 0;
  const shouldDisplayConnectSnapshot =
    remoteDisplayQueue.length > 0 &&
    (isRemoteConnectActive || (legacyConnectEnabled && !currentTrack));
  const displayTrack = shouldDisplayConnectSnapshot
    ? remoteDisplayQueue[remoteDisplayIndex]
    : currentTrack;
  const displayQueue = shouldDisplayConnectSnapshot
    ? remoteDisplayQueue
    : queue;
  const displayCurrentIndex = shouldDisplayConnectSnapshot
    ? remoteDisplayIndex
    : currentIndex;
  const displayPlaySource = (
    shouldDisplayConnectSnapshot && remoteConnectState?.play_source
      ? remoteConnectState.play_source
      : playSource
  ) as PlaySource | null;
  const displayCrossfadeTransition = isRemoteConnectActive
    ? null
    : crossfadeTransition;
  const effectiveIsBuffering = isRemoteConnectActive ? false : isBuffering;

  const displayTrackForQueries = displayTrack ?? undefined;
  const shouldResolveTrackInfo = shouldFetchTrackQualityInfo(
    displayTrackForQueries,
  );
  const { info: currentTrackInfo } = useTrackInfo(displayTrackForQueries, {
    enabled: shouldResolveTrackInfo,
  });
  const { resolution: currentTrackPlayback } = useTrackPlayback(
    displayTrackForQueries,
    getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy),
    {
      enabled: !!displayTrack,
    },
  );
  const sourceTrackQuality = displayTrack
    ? mergeTrackQualityParts(
        getTrackQualityFallback(displayTrack),
        getTrackQualityFromInfo(currentTrackInfo),
        getTrackQualityFromPlaybackQuality(currentTrackPlayback?.source),
      )
    : null;
  const showsDeliveryQuality =
    playbackResolutionShowsDeliveryQuality(currentTrackPlayback);
  const activeTrackQuality =
    currentTrackPlayback && showsDeliveryQuality
      ? mergeTrackQualityParts(
          sourceTrackQuality,
          getTrackQualityFromPlaybackQuality(currentTrackPlayback.delivery, {
            preferCodec: true,
          }),
        )
      : sourceTrackQuality;
  const qualityBadge = displayTrack
    ? getQualityBadge({
        id: displayTrack.id,
        path: displayTrack.path,
        ...(activeTrackQuality ?? {}),
      })
    : null;
  const progressPct =
    effectiveDisplayedDuration > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (effectiveDisplayedTime / effectiveDisplayedDuration) * 100,
          ),
        )
      : 0;
  const shapedRadioSessionId = displayPlaySource?.radio?.shapedSessionId;
  const isShapedRadioTrack = !!(
    shapedRadioSessionId && displayTrack?.libraryTrackId
  );
  const sourceLabel = getPlaySourceLabel(displayPlaySource);
  const hidePlayerBarForMobileFullscreen = !isDesktop && fsOpen;

  const playbackTargetContext = useMemo<PlaybackTargetContext>(
    () => ({
      currentTrack: displayTrack,
      currentTime: effectiveDisplayedTime,
      currentIndex: displayCurrentIndex,
      queue: displayQueue,
      volume: effectiveVolume,
      activeConnectDeviceId: legacyConnectEnabled
        ? activeConnectDeviceId
        : null,
      activeConnectSession: legacyConnectEnabled ? activeConnectSession : null,
      connect,
      pause,
      publishConnectState,
    }),
    [
      activeConnectDeviceId,
      activeConnectSession,
      connect,
      displayCurrentIndex,
      displayQueue,
      displayTrack,
      effectiveDisplayedTime,
      effectiveVolume,
      legacyConnectEnabled,
      pause,
      publishConnectState,
    ],
  );

  useEffect(() => {
    if (!isDesktop && fsOpen) {
      setShouldRenderFullscreenPlayer(true);
      void preloadFullscreenPlayer();
    }
  }, [fsOpen, isDesktop]);

  useEffect(() => {
    const handleOpenFullscreen = () => {
      if (isDesktop || !currentTrack) return;
      setShouldRenderFullscreenPlayer(true);
      void preloadFullscreenPlayer();
      setFsOpen(true);
    };
    window.addEventListener(
      "crate:open-fullscreen-player",
      handleOpenFullscreen,
    );
    return () => {
      window.removeEventListener(
        "crate:open-fullscreen-player",
        handleOpenFullscreen,
      );
    };
  }, [currentTrack, isDesktop, setFsOpen]);

  useEffect(() => {
    const handleOpenQueue = () => {
      if (!displayTrack) return;
      setShouldRenderQueuePanel(true);
      void preloadQueuePanel();
      setShowQueue(true);
      setShowLyrics(false);
      setShowEqualizer(false);
    };
    window.addEventListener("crate:open-player-queue", handleOpenQueue);
    return () => {
      window.removeEventListener("crate:open-player-queue", handleOpenQueue);
    };
  }, [displayTrack]);

  useEffect(() => clearCoverLongPressTimer, [clearCoverLongPressTimer]);

  if (!displayTrack) return null;

  const liked = isLiked(
    displayTrack.libraryTrackId ?? null,
    displayTrack.entityUid ?? null,
    displayTrack.path || displayTrack.id,
    displayTrack.globalTrackUid ?? null,
  );

  function prepareQueuePanel() {
    setShouldRenderQueuePanel(true);
    void preloadQueuePanel();
  }

  function prepareLyricsPanel() {
    if (isRemoteConnectActive) return;
    setShouldRenderLyricsPanel(true);
    void preloadLyricsPanel();
  }

  function prepareEqualizerPopover() {
    if (isRemoteConnectActive) return;
    setShouldRenderEqualizerPopover(true);
    void preloadEqualizerPopover();
  }

  function prepareExtendedPlayer() {
    if (isRemoteConnectActive) return;
    setShouldRenderExtendedPlayer(true);
    void preloadExtendedPlayer();
  }

  function prepareFullscreenPlayer() {
    if (isRemoteConnectActive) return;
    void preloadFullscreenPlayer();
  }

  function openFullscreenPlayer() {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    setShouldRenderFullscreenPlayer(true);
    void preloadFullscreenPlayer();
    setFsOpen(true);
  }

  function handleToggleShuffle() {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    toggleShuffle();
  }

  function handleCycleRepeat() {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    cycleRepeat();
  }

  function handleToggleQueue() {
    triggerHaptic("selection");
    prepareQueuePanel();
    setShowQueue(!showQueue);
    setShowLyrics(false);
  }

  function handleToggleLyrics() {
    if (isRemoteConnectActive) return;
    triggerHaptic("selection");
    prepareLyricsPanel();
    setShowLyrics(!showLyrics);
    setShowQueue(false);
  }

  function handleToggleEqualizer() {
    triggerHaptic("selection");
    prepareEqualizerPopover();
    setShowEqualizer((value) => !value);
    setShowQueue(false);
    setShowLyrics(false);
  }

  function handleToggleExtendedPlayer() {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    prepareExtendedPlayer();
    setExtendedOpen(!extendedOpen);
    if (!extendedOpen) {
      setShowQueue(false);
      setShowLyrics(false);
    }
  }

  async function toggleLike(): Promise<boolean | null> {
    if (!displayTrack) return null;
    const trackId = displayTrack.libraryTrackId ?? null;
    const trackEntityUid = displayTrack.entityUid ?? null;
    const trackPath = displayTrack.path || displayTrack.id;
    try {
      if (liked) {
        await unlikeTrack(
          trackId,
          trackEntityUid,
          trackPath,
          displayTrack.globalTrackUid ?? null,
        );
        return false;
      } else {
        await likeTrack(
          trackId,
          trackEntityUid,
          trackPath,
          displayTrack.globalTrackUid ?? null,
        );
        return true;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function handleCoverTouchStart() {
    if (isDesktop) return;
    coverLongPressTriggeredRef.current = false;
    clearCoverLongPressTimer();
    coverLongPressTimerRef.current = window.setTimeout(() => {
      coverLongPressTriggeredRef.current = true;
      coverLongPressTimerRef.current = null;
      triggerHaptic("selection");
      void toggleLike().then((nextLiked) => {
        if (nextLiked === null) return;
        toast.success(
          nextLiked ? "Added to liked tracks" : "Removed from liked tracks",
        );
      });
    }, 520);
  }

  function handleCoverTouchMove() {
    clearCoverLongPressTimer();
  }

  function handleCoverTouchEnd() {
    clearCoverLongPressTimer();
  }

  async function handleAddToCollection() {
    if (!displayTrack) return;
    try {
      await likeTrack(
        displayTrack.libraryTrackId ?? null,
        displayTrack.entityUid ?? null,
        displayTrack.path || displayTrack.id,
        displayTrack.globalTrackUid ?? null,
      );
      toast.success("Added to collection");
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      {/* Screen reader announcement for track changes */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {effectiveIsPlaying
          ? `Now playing ${displayTrack.title} by ${displayTrack.artist}`
          : `Paused: ${displayTrack.title} by ${displayTrack.artist}`}
      </div>

      {!hidePlayerBarForMobileFullscreen ? (
        <div
          className={cn(
            "fixed isolate h-[var(--listen-mobile-player-height)] overflow-visible transition-all duration-200 md:left-3 md:right-3 md:h-[82px]",
            hasFloatingOverlayOpen ? "z-app-player-overlay" : "z-app-player",
          )}
          style={{
            bottom: isDesktop
              ? 12
              : "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset) + var(--listen-mobile-bottom-nav-content-height))",
            left: isDesktop ? undefined : "max(1rem, var(--listen-safe-left))",
            right: isDesktop
              ? undefined
              : "max(1rem, var(--listen-safe-right))",
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 z-0",
              isDesktop
                ? "listen-player-shell md:rounded-[12px] md:backdrop-blur-xl"
                : "rounded-t-[2rem] rounded-b-none",
            )}
          />
          <div
            className={cn(
              "relative z-10 flex h-full items-center gap-2",
              isDesktop ? "px-3 lg:px-4" : "px-4 pt-3 pb-0.5",
            )}
          >
            <PlayerBarTrackInfo
              displayTrack={displayTrack}
              displayCrossfadeTransition={displayCrossfadeTransition}
              crossfadeProgress={crossfadeProgress}
              displayPlaySource={displayPlaySource}
              sourceLabel={sourceLabel}
              isDesktop={isDesktop}
              liked={liked}
              isShapedRadioTrack={isShapedRadioTrack}
              shapedRadioSessionId={shapedRadioSessionId}
              effectiveDisplayedDuration={effectiveDisplayedDuration}
              duration={duration}
              onNavigate={navigate}
              onPrepareFullscreen={prepareFullscreenPlayer}
              onOpenFullscreen={openFullscreenPlayer}
              onCoverTouchStart={handleCoverTouchStart}
              onCoverTouchMove={handleCoverTouchMove}
              onCoverTouchEnd={handleCoverTouchEnd}
              isCoverLongPressTriggered={() =>
                coverLongPressTriggeredRef.current
              }
              resetCoverLongPress={() => {
                coverLongPressTriggeredRef.current = false;
              }}
              onToggleLike={() => {
                void toggleLike();
              }}
              onNextTrack={handleNextTrack}
              onAddToCollection={handleAddToCollection}
              onOverlayChange={setHasFloatingOverlayOpen}
            />
            <PlayerBarTransportControls
              t={t}
              frequenciesDb={frequenciesDb}
              sampleRate={sampleRate}
              showAnalyzer={showPlayerBarAnalyzer}
              isPlaying={isPlaying}
              shuffle={shuffle}
              repeat={repeat}
              jamQueueLocked={jamQueueLocked}
              jamTransportDisabled={jamTransportDisabled}
              effectiveIsPlaying={effectiveIsPlaying}
              effectiveIsBuffering={effectiveIsBuffering}
              effectiveDisplayedTime={effectiveDisplayedTime}
              effectiveDisplayedDuration={effectiveDisplayedDuration}
              progressPct={progressPct}
              seekHover={seekHover}
              onSeekHoverChange={setSeekHover}
              onToggleShuffle={handleToggleShuffle}
              onPreviousTrack={handlePreviousTrack}
              onPlayPause={handlePlayPause}
              onNextTrack={handleNextTrack}
              onCycleRepeat={handleCycleRepeat}
              onSeek={handleSeek}
            />

            <PlayerBarActionButtons
              t={t}
              qualityBadge={qualityBadge}
              showsDeliveryQuality={showsDeliveryQuality}
              effectiveVolume={effectiveVolume}
              onVolumeChange={handleVolumeChange}
              onOverlayChange={setHasFloatingOverlayOpen}
              playbackTargetContext={playbackTargetContext}
              visibility={{
                isRemoteConnectActive,
                extendedOpen,
                allowEqualizer,
                showEqualizer,
                showQueue,
                showLyrics,
              }}
              displayQueue={displayQueue}
              displayCurrentIndex={displayCurrentIndex}
              onToggleEqualizer={handleToggleEqualizer}
              onPrepareEqualizer={prepareEqualizerPopover}
              onToggleQueue={handleToggleQueue}
              onPrepareQueue={prepareQueuePanel}
              onToggleLyrics={handleToggleLyrics}
              onPrepareLyrics={prepareLyricsPanel}
              onToggleExtendedPlayer={handleToggleExtendedPlayer}
              onPrepareExtendedPlayer={prepareExtendedPlayer}
            />
          </div>
        </div>
      ) : null}
      {shouldRenderQueuePanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyQueuePanel
            open={showQueue}
            onClose={() => setShowQueue(false)}
          />
        </Suspense>
      ) : null}
      {shouldRenderLyricsPanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyLyricsPanel
            open={showLyrics}
            onClose={() => setShowLyrics(false)}
          />
        </Suspense>
      ) : null}
      {shouldRenderEqualizerPopover ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyEqualizerPopover
            open={showEqualizer}
            onClose={() => setShowEqualizer(false)}
          />
        </Suspense>
      ) : null}
      {shouldRenderExtendedPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyExtendedPlayer
            open={extendedOpen}
            onClose={() => setExtendedOpen(false)}
          />
        </Suspense>
      ) : null}
      {!isDesktop && shouldRenderFullscreenPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback fullscreen />}>
          <LazyFullscreenPlayer
            open={fsOpen}
            onClose={() => setFsOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
