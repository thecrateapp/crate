import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
import {
  preloadEqualizerPopover,
  preloadExtendedPlayer,
  preloadFullscreenPlayer,
  preloadLyricsPanel,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { PlayerBarTransportControls } from "@/components/player/bar/PlayerBarTransportControls";
import { PlayerBarActionButtons } from "@/components/player/bar/PlayerBarActionButtons";
import { PlayerBarSurfaces } from "@/components/player/bar/PlayerBarSurfaces";
import type { PlaybackTargetContext } from "@/lib/playback-targets";
import { remotePlaybackQueue } from "@/lib/remote-playback-state";
import { getPlaySourceLabel } from "@/components/player/player-source";
import {
  getQualityBadge,
  shouldFetchTrackQualityInfo,
} from "@/components/player/bar/player-bar-utils";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";
import { usePlayerBarRemotePlayback } from "@/components/player/bar/usePlayerBarRemotePlayback";

const FS_OPEN_KEY = "listen-fs-player-open";
const SHOW_PLAYER_BAR_ANALYZER = true;

function getStoredFsOpen(): boolean {
  try {
    return localStorage.getItem(FS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export { PlayerSurfaceFallback } from "@/components/player/bar/PlayerSurfaceFallback";

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

  const coverLongPressTimerRef = useRef<number | null>(null);
  const coverLongPressTriggeredRef = useRef(false);
  const clearCoverLongPressTimer = useCallback(() => {
    if (coverLongPressTimerRef.current === null) return;
    window.clearTimeout(coverLongPressTimerRef.current);
    coverLongPressTimerRef.current = null;
  }, []);

  const {
    legacyConnectEnabled,
    activeConnectDeviceId,
    activeConnectSession,
    remoteConnectState,
    isRemoteConnectActive,
    effectiveIsPlaying,
    effectiveDisplayedTime,
    effectiveDisplayedDuration,
    effectiveVolume,
    handlePlayPause,
    handlePreviousTrack,
    handleNextTrack,
    handleSeek,
    handleVolumeChange,
  } = usePlayerBarRemotePlayback({
    isPlaying,
    displayedTime,
    displayedDuration,
    volume,
    jamQueueLocked,
    actions: {
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      connect,
    },
  });

  const { frequenciesDb, sampleRate } = useAudioVisualizer(
    showPlayerBarAnalyzer && isPlaying && !isRemoteConnectActive,
    `${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
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
      <PlayerBarSurfaces
        state={{
          isDesktop,
          fsOpen,
          showQueue,
          showLyrics,
          showEqualizer,
          extendedOpen,
          shouldRenderQueuePanel,
          shouldRenderLyricsPanel,
          shouldRenderEqualizerPopover,
          shouldRenderExtendedPlayer,
          shouldRenderFullscreenPlayer,
        }}
        onCloseQueue={() => setShowQueue(false)}
        onCloseLyrics={() => setShowLyrics(false)}
        onCloseEqualizer={() => setShowEqualizer(false)}
        onCloseExtendedPlayer={() => setExtendedOpen(false)}
        onCloseFullscreenPlayer={() => setFsOpen(false)}
      />
    </>
  );
}
