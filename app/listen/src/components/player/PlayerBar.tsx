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
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  HeartBold,
  ListMusic,
  Mic2,
  Maximize2,
  Loader2,
  SlidersHorizontal,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import type { PlaySource } from "@/contexts/player-types";
import { artistPagePath, albumPagePath } from "@/lib/library-routes";
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
import { RadioFeedback } from "@/components/player/RadioFeedback";
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
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import { CrateImage } from "@/components/artwork/CrateImage";
import { SpectrumPlayButton } from "@/components/player/SpectrumPlayButton";
import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";
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
  formatPlayerTime,
  getQualityBadge,
  shouldFetchTrackQualityInfo,
} from "@/components/player/bar/player-bar-utils";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
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
            {/* ── Block 1: Track Info ── */}
            <div
              role={isDesktop ? undefined : "button"}
              tabIndex={isDesktop ? undefined : 0}
              aria-label={isDesktop ? undefined : "Open fullscreen player"}
              className="flex min-w-0 shrink-0 flex-1 touch-manipulation cursor-pointer items-center gap-3 rounded-xl md:w-[260px] md:flex-none md:cursor-default lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]"
              onTouchStart={() => {
                if (!isDesktop) prepareFullscreenPlayer();
              }}
              onClick={() => {
                if (!isDesktop) openFullscreenPlayer();
              }}
              onKeyDown={(e) => {
                if (!isDesktop && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openFullscreenPlayer();
                }
              }}
            >
              {/* Album art — crossfades outgoing ↔ incoming during audio crossfade.
                On desktop, clicking navigates to the album page. */}
              <div
                aria-label={isDesktop ? undefined : "Track artwork"}
                className={`listen-player-artwork relative h-10 w-10 shrink-0 overflow-hidden rounded-md md:h-12 md:w-12 ${
                  isDesktop &&
                  (displayTrack.globalAlbumUid || displayTrack.albumId)
                    ? "cursor-pointer"
                    : ""
                }`}
                onTouchStart={handleCoverTouchStart}
                onTouchMove={handleCoverTouchMove}
                onTouchEnd={handleCoverTouchEnd}
                onTouchCancel={handleCoverTouchEnd}
                onClick={(e) => {
                  if (!isDesktop && coverLongPressTriggeredRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    coverLongPressTriggeredRef.current = false;
                    return;
                  }
                  if (
                    isDesktop &&
                    (displayTrack.globalAlbumUid || displayTrack.albumId)
                  ) {
                    e.stopPropagation();
                    navigate(
                      displayTrack.globalAlbumUid
                        ? albumPagePath({
                            albumId: displayTrack.albumId,
                            globalAlbumUid: displayTrack.globalAlbumUid,
                            albumSlug: displayTrack.albumSlug,
                            albumName: displayTrack.album,
                            artistName: displayTrack.artist,
                          })
                        : albumPagePath({
                            albumId: displayTrack.albumId,
                            albumSlug: displayTrack.albumSlug,
                            albumName: displayTrack.album,
                            artistName: displayTrack.artist,
                          }),
                    );
                  }
                }}
              >
                {displayCrossfadeTransition ? (
                  <>
                    {displayCrossfadeTransition.outgoing.albumCover ? (
                      <CrateImage
                        src={displayCrossfadeTransition.outgoing.albumCover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ opacity: 1 - crossfadeProgress }}
                      />
                    ) : null}
                    {displayCrossfadeTransition.incoming.albumCover ? (
                      <CrateImage
                        src={displayCrossfadeTransition.incoming.albumCover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ opacity: crossfadeProgress }}
                      />
                    ) : null}
                  </>
                ) : displayTrack.albumCover ? (
                  <CrateImage
                    src={displayTrack.albumCover}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="listen-player-artwork-placeholder h-full w-full" />
                )}
                {!isDesktop && liked ? (
                  <span
                    aria-label="Liked track"
                    className="listen-player-liked-indicator absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full backdrop-blur-md"
                  >
                    <HeartBold
                      size={10}
                      className="animate-crate-icon-active-pulse"
                    />
                  </span>
                ) : null}
              </div>

              {/* Text — crossfades outgoing ↔ incoming. Stacks absolutely to allow
                overlap without layout jump. */}
              <div className="min-w-0 flex-1 md:flex-none md:max-w-[220px] lg:max-w-[300px] xl:max-w-[min(24vw,420px)] 2xl:max-w-[min(28vw,520px)]">
                {/* Title + artist crossfade between outgoing and incoming.
                  Wrapped in its own relative block so the absolute
                  outgoing copy doesn't escape into the persistent rows
                  below ("Playing from", "Buffering"). */}
                <div className="relative">
                  {displayCrossfadeTransition ? (
                    <>
                      <div
                        className="absolute inset-0"
                        style={{ opacity: 1 - crossfadeProgress }}
                      >
                        <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">
                          {displayCrossfadeTransition.outgoing.title}
                        </p>
                        <p className="text-[11px] text-text-muted truncate leading-tight mt-0.5">
                          {displayCrossfadeTransition.outgoing.artist}
                        </p>
                      </div>
                      <div style={{ opacity: crossfadeProgress }}>
                        <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">
                          {displayCrossfadeTransition.incoming.title}
                        </p>
                        <p className="text-[11px] text-text-muted truncate leading-tight mt-0.5">
                          {displayCrossfadeTransition.incoming.artist}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div key={displayTrack.id} className="animate-track-in">
                      {isDesktop &&
                      (displayTrack.globalAlbumUid || displayTrack.albumId) ? (
                        <p
                          className="text-[13px] font-semibold text-text-primary truncate leading-tight hover:underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(
                              displayTrack.globalAlbumUid
                                ? albumPagePath({
                                    albumId: displayTrack.albumId,
                                    globalAlbumUid: displayTrack.globalAlbumUid,
                                    albumSlug: displayTrack.albumSlug,
                                    albumName: displayTrack.album,
                                    artistName: displayTrack.artist,
                                  })
                                : albumPagePath({
                                    albumId: displayTrack.albumId,
                                    albumSlug: displayTrack.albumSlug,
                                    albumName: displayTrack.album,
                                    artistName: displayTrack.artist,
                                  }),
                            );
                          }}
                        >
                          {displayTrack.title}
                        </p>
                      ) : (
                        <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">
                          {displayTrack.title}
                        </p>
                      )}
                      {isDesktop &&
                      (displayTrack.globalArtistUid ||
                        displayTrack.artistId) ? (
                        <p
                          className="text-[11px] text-text-muted truncate leading-tight mt-0.5 hover:text-text-primary hover:underline cursor-pointer transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(
                              displayTrack.globalArtistUid
                                ? artistPagePath({
                                    artistId: displayTrack.artistId,
                                    globalArtistUid:
                                      displayTrack.globalArtistUid,
                                    artistSlug: displayTrack.artistSlug,
                                    artistName: displayTrack.artist,
                                  })
                                : artistPagePath({
                                    artistId: displayTrack.artistId,
                                    artistSlug: displayTrack.artistSlug,
                                    artistName: displayTrack.artist,
                                  }),
                            );
                          }}
                        >
                          {displayTrack.artist}
                        </p>
                      ) : (
                        <p className="text-[11px] text-text-muted truncate leading-tight mt-0.5">
                          {displayTrack.artist}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {/* Persistent metadata that shouldn't blink during a
                  track crossfade — kept outside the fading block.
                  When the source itself changes (album → playlist) the
                  outgoing line fades out while the incoming fades in. */}
                {sourceLabel && (
                  <div className="relative mt-0.5 h-[14px] hidden lg:block">
                    <p
                      key={`src-${sourceLabel}`}
                      className="text-[10px] text-text-muted truncate leading-tight animate-fade-in"
                    >
                      Playing from:{" "}
                      {displayPlaySource?.href &&
                      sourceLabel !== "Discovery Radio" ? (
                        <span
                          className="hover:text-text-primary hover:underline cursor-pointer transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(displayPlaySource.href!);
                          }}
                        >
                          {sourceLabel}
                        </span>
                      ) : (
                        sourceLabel
                      )}
                    </p>
                  </div>
                )}
              </div>

              {isDesktop ? (
                <div className="ml-1 flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleLike();
                    }}
                    className="shrink-0 p-1.5 transition-[color,filter,transform] hover:-translate-y-px"
                  >
                    {liked ? (
                      <HeartBold
                        size={CRATE_ICON_SIZE.md}
                        className="animate-crate-icon-active-pulse text-accent-action"
                      />
                    ) : (
                      <Heart
                        size={CRATE_ICON_SIZE.md}
                        className="text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
                      />
                    )}
                  </button>

                  {isShapedRadioTrack && (
                    <RadioFeedback
                      sessionId={shapedRadioSessionId!}
                      trackId={displayTrack.libraryTrackId}
                      globalTrackUid={displayTrack.globalTrackUid}
                      onDislike={handleNextTrack}
                    />
                  )}

                  <div onClick={(e) => e.stopPropagation()}>
                    <PlayerTrackMenu
                      currentTrack={displayTrack}
                      duration={effectiveDisplayedDuration || duration}
                      onOverlayChange={setHasFloatingOverlayOpen}
                      onAddToCollection={handleAddToCollection}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── Block 2: Controls + Progress ── */}
            <div className="mx-auto hidden max-w-[640px] flex-1 md:flex md:items-center md:justify-center">
              <div className="relative w-full overflow-visible px-4 py-2">
                {showPlayerBarAnalyzer ? (
                  <div className="pointer-events-none absolute -inset-y-2 -inset-x-10 opacity-26 [mask-image:radial-gradient(ellipse_at_center,rgba(0,0,0,0.96)_18%,rgba(0,0,0,0.9)_44%,rgba(0,0,0,0.34)_74%,transparent_100%)] [mask-repeat:no-repeat]">
                    <WaveformCanvas
                      frequenciesDb={frequenciesDb}
                      sampleRate={sampleRate}
                      isPlaying={isPlaying}
                    />
                  </div>
                ) : null}

                <div className="relative flex items-center justify-center gap-3 lg:gap-5">
                  <button
                    onClick={handleToggleShuffle}
                    disabled={jamQueueLocked}
                    aria-label={
                      shuffle
                        ? t("player.disableShuffle")
                        : t("player.enableShuffle")
                    }
                    className={`transition-colors disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
                      shuffle
                        ? "text-accent-action drop-shadow-accent-action"
                        : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
                    }`}
                  >
                    <Shuffle size={CRATE_ICON_SIZE.md} />
                  </button>
                  <button
                    onClick={handlePreviousTrack}
                    disabled={jamQueueLocked}
                    aria-label={t("player.previous")}
                    className="text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:text-text-secondary"
                  >
                    <SkipBack size={CRATE_ICON_SIZE.lg} fill="currentColor" />
                  </button>
                  <SpectrumPlayButton
                    onClick={handlePlayPause}
                    disabled={jamTransportDisabled}
                    aria-label={
                      effectiveIsPlaying ? t("player.pause") : t("player.play")
                    }
                    size="sm"
                    active={effectiveIsPlaying}
                    className="disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {effectiveIsBuffering ? (
                      <Loader2
                        size={17}
                        className="animate-spin text-text-primary"
                      />
                    ) : effectiveIsPlaying ? (
                      <Pause
                        size={CRATE_ICON_SIZE.md}
                        className="text-text-primary"
                      />
                    ) : (
                      <Play
                        size={CRATE_ICON_SIZE.md}
                        className="ml-0.5 text-text-primary"
                        fill="currentColor"
                      />
                    )}
                  </SpectrumPlayButton>
                  <button
                    onClick={handleNextTrack}
                    disabled={jamTransportDisabled}
                    aria-label={t("player.next")}
                    className="text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:text-text-secondary"
                  >
                    <SkipForward
                      size={CRATE_ICON_SIZE.lg}
                      fill="currentColor"
                    />
                  </button>
                  <button
                    onClick={handleCycleRepeat}
                    disabled={jamQueueLocked}
                    aria-label={t("player.repeat", { mode: repeat })}
                    className={`transition-colors disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
                      repeat !== "off"
                        ? "text-accent-action drop-shadow-accent-action"
                        : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
                    }`}
                  >
                    {repeat === "one" ? (
                      <Repeat1 size={CRATE_ICON_SIZE.md} />
                    ) : (
                      <Repeat size={CRATE_ICON_SIZE.md} />
                    )}
                  </button>
                </div>

                <div className="relative mt-2 flex items-center gap-2 w-full">
                  <span className="w-9 text-right font-mono text-[10px] tabular-nums text-text-muted">
                    {formatPlayerTime(effectiveDisplayedTime)}
                  </span>
                  <div
                    className={`listen-player-progress group relative flex-1 py-2 ${
                      jamQueueLocked
                        ? "pointer-events-none grayscale opacity-40"
                        : "cursor-pointer"
                    }`}
                    aria-disabled={jamQueueLocked}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = Math.max(
                        0,
                        Math.min(1, (e.clientX - rect.left) / rect.width),
                      );
                      handleSeek(pct * effectiveDisplayedDuration);
                    }}
                    onPointerMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = Math.max(
                        0,
                        Math.min(1, (e.clientX - rect.left) / rect.width),
                      );
                      setSeekHover({
                        pct,
                        time: formatPlayerTime(
                          pct * effectiveDisplayedDuration,
                        ),
                      });
                    }}
                    onPointerLeave={() => setSeekHover(null)}
                  >
                    {seekHover && effectiveDisplayedDuration > 0 && (
                      <div
                        className="listen-player-progress-tooltip pointer-events-none absolute -top-6 -translate-x-1/2 rounded border px-1.5 py-0.5 text-[10px] tabular-nums"
                        style={{ left: `${seekHover.pct * 100}%` }}
                      >
                        {seekHover.time}
                      </div>
                    )}
                    <div className="listen-player-progress-track absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" />
                    <div
                      className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
                      style={{ width: `${progressPct}%` }}
                    >
                      <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
                      <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
                    </div>
                    <div
                      className="listen-player-progress-fill absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-150"
                      style={{ width: `${progressPct}%` }}
                    />
                    <div
                      className="listen-player-progress-thumb pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-[left,opacity] duration-150"
                      style={{
                        left: `calc(${progressPct}% - 4px)`,
                        opacity: progressPct > 0 ? 0.62 : 0,
                      }}
                    />
                    <div
                      className="listen-player-progress-thumb-active absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-[left,opacity] duration-150 group-hover:opacity-100"
                      style={{ left: `calc(${progressPct}% - 5px)` }}
                    />
                  </div>
                  <span className="w-9 font-mono text-[10px] tabular-nums text-text-muted">
                    {formatPlayerTime(effectiveDisplayedDuration)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Mobile/tablet play controls (md only, no progress) ── */}
            <div className="flex items-center gap-1 self-stretch md:hidden">
              <SpectrumPlayButton
                onClick={handlePlayPause}
                disabled={jamTransportDisabled}
                aria-label={
                  effectiveIsPlaying ? t("player.pause") : t("player.play")
                }
                size="md"
                active={effectiveIsPlaying}
                className="touch-manipulation disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
              >
                {effectiveIsBuffering ? (
                  <Loader2
                    size={CRATE_ICON_SIZE.md}
                    className="animate-spin text-text-primary"
                  />
                ) : effectiveIsPlaying ? (
                  <Pause
                    size={CRATE_ICON_SIZE.lg}
                    className="text-text-primary"
                  />
                ) : (
                  <Play
                    size={CRATE_ICON_SIZE.lg}
                    className="ml-0.5 text-text-primary"
                    fill="currentColor"
                  />
                )}
              </SpectrumPlayButton>
              <button
                onClick={handleNextTrack}
                disabled={jamTransportDisabled}
                aria-label={t("player.next")}
                className="flex h-12 w-12 touch-manipulation items-center justify-center text-text-secondary transition-[color,filter,transform] hover:text-accent-action hover:drop-shadow-accent-action active:scale-[0.96] active:text-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:text-text-secondary disabled:active:scale-100"
              >
                <SkipForward
                  size={CRATE_ICON_SIZE.navMobile}
                  fill="currentColor"
                />
              </button>
            </div>

            {/* ── Block 3: Action Buttons ── */}
            <div className="hidden shrink-0 items-center justify-end md:flex md:w-[260px] lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]">
              <div className="hidden items-center justify-end gap-1 lg:flex">
                {/* Quality badge */}
                {qualityBadge && (
                  <span className="mr-1 inline-flex items-center">
                    <QualityBadge
                      badge={qualityBadge}
                      origin={showsDeliveryQuality ? "stream" : "source"}
                    />
                  </span>
                )}

                {/* Volume */}
                <PlayerVolumeControl
                  volume={effectiveVolume}
                  onVolumeChange={handleVolumeChange}
                  onOverlayChange={setHasFloatingOverlayOpen}
                />

                <PlaybackTargetMenu
                  onOverlayChange={setHasFloatingOverlayOpen}
                  targetContext={playbackTargetContext}
                />

                {/* Equalizer (hidden when extended player is open) */}
                {!isRemoteConnectActive && !extendedOpen && allowEqualizer && (
                  <button
                    onClick={() => {
                      triggerHaptic("selection");
                      prepareEqualizerPopover();
                      setShowEqualizer((v) => !v);
                      setShowQueue(false);
                      setShowLyrics(false);
                    }}
                    onMouseEnter={prepareEqualizerPopover}
                    onFocus={prepareEqualizerPopover}
                    aria-label={t("player.equalizer")}
                    className={`p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                      showEqualizer ? "text-accent-action" : "text-text-muted"
                    }`}
                  >
                    <SlidersHorizontal size={CRATE_ICON_SIZE.md} />
                  </button>
                )}

                {/* Queue (hidden when extended player is open) */}
                {!extendedOpen && (
                  <button
                    onClick={handleToggleQueue}
                    onMouseEnter={prepareQueuePanel}
                    onFocus={prepareQueuePanel}
                    className={`relative p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                      showQueue ? "text-accent-action" : "text-text-muted"
                    }`}
                    aria-label={t("player.queue")}
                  >
                    <ListMusic size={CRATE_ICON_SIZE.md} />
                    {displayQueue.length > 1 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-action text-[8px] font-bold text-accent-action-foreground">
                        {displayQueue.length - displayCurrentIndex - 1}
                      </span>
                    )}
                  </button>
                )}

                {/* Lyrics (hidden when extended player is open) */}
                {!isRemoteConnectActive && !extendedOpen && (
                  <button
                    onClick={handleToggleLyrics}
                    onMouseEnter={prepareLyricsPanel}
                    onFocus={prepareLyricsPanel}
                    className={`hidden p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action xl:block ${
                      showLyrics ? "text-accent-action" : "text-text-muted"
                    }`}
                    aria-label={t("player.lyrics")}
                  >
                    <Mic2 size={CRATE_ICON_SIZE.md} />
                  </button>
                )}

                {/* Extended / Full player */}
                {!isRemoteConnectActive && (
                  <button
                    onClick={handleToggleExtendedPlayer}
                    onMouseEnter={prepareExtendedPlayer}
                    onFocus={prepareExtendedPlayer}
                    className={`p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                      extendedOpen ? "text-accent-action" : "text-text-muted"
                    }`}
                    aria-label={t("player.expand")}
                  >
                    <Maximize2 size={CRATE_ICON_SIZE.md} />
                  </button>
                )}
              </div>
            </div>

            {/* ── Compact action buttons (md only, no lg) ── */}
            <div className="hidden items-center gap-1 md:flex lg:hidden">
              {!extendedOpen && (
                <button
                  onClick={handleToggleQueue}
                  onMouseEnter={prepareQueuePanel}
                  onFocus={prepareQueuePanel}
                  aria-label={t("player.queue")}
                  className={`relative p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                    showQueue ? "text-accent-action" : "text-text-muted"
                  }`}
                >
                  <ListMusic size={CRATE_ICON_SIZE.md} />
                </button>
              )}
              {!isRemoteConnectActive && (
                <button
                  onClick={handleToggleExtendedPlayer}
                  onMouseEnter={prepareExtendedPlayer}
                  onFocus={prepareExtendedPlayer}
                  aria-label={t("player.expand")}
                  className={`p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                    extendedOpen ? "text-accent-action" : "text-text-muted"
                  }`}
                >
                  <Maximize2 size={CRATE_ICON_SIZE.md} />
                </button>
              )}
            </div>
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
