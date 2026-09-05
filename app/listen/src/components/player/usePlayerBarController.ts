import { useCallback, useState } from "react";

import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { usePlayerBarActions } from "./bar/usePlayerBarActions";
import { usePlayerBarComputedState } from "./bar/usePlayerBarComputedState";
import { usePlayerBarDisplayState } from "./bar/usePlayerBarDisplayState";
import {
  usePlayerBarEqualizerEffect,
  usePlayerBarExternalSurfaceEffects,
  usePlayerBarLongPressEffect,
  usePlayerBarMobileSurfaceEffect,
  usePlayerBarNativeBackEffect,
  usePlayerBarPlaybackPreferenceEffect,
  usePlayerBarRemoteSurfaceEffect,
} from "./bar/usePlayerBarLifecycle";
import { usePlayerBarGestures } from "./bar/usePlayerBarGestures";
import { usePlayerBarRemotePlayback } from "./bar/usePlayerBarRemotePlayback";

const FS_OPEN_KEY = "listen-fs-player-open";
const SHOW_PLAYER_BAR_ANALYZER = true;

function getStoredFsOpen(): boolean {
  try {
    return localStorage.getItem(FS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function usePlayerBarController() {
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

  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );

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

  usePlayerBarEqualizerEffect(allowEqualizer, setShowEqualizer);

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

  usePlayerBarNativeBackEffect({
    extendedOpen,
    fsOpen,
    hasFloatingOverlayOpen,
    setExtendedOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
    showEqualizer,
    showLyrics,
    showQueue,
  });
  usePlayerBarMobileSurfaceEffect({
    isDesktop,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
  });
  usePlayerBarRemoteSurfaceEffect({
    isRemoteConnectActive,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
  });
  usePlayerBarPlaybackPreferenceEffect({
    eventName: PLAYER_PLAYBACK_PREFS_EVENT,
    getPreference: getPlaybackDeliveryPolicyPreference,
    setPlaybackDeliveryPolicy,
  });

  const { handleTouchEnd, handleTouchStart } = usePlayerBarGestures({
    onNextTrack: handleNextTrack,
    onPreviousTrack: handlePreviousTrack,
  });

  const {
    displayTrack,
    displayQueue,
    displayCurrentIndex,
    displayPlaySource,
    qualityBadge,
    showsDeliveryQuality,
    shapedRadioSessionId,
    isShapedRadioTrack,
    sourceLabel,
  } = usePlayerBarDisplayState({
    currentTrack,
    queue,
    currentIndex,
    playSource,
    remoteConnectState,
    isRemoteConnectActive,
    legacyConnectEnabled,
    playbackDeliveryPolicy,
  });
  const {
    displayCrossfadeTransition,
    effectiveIsBuffering,
    hidePlayerBarForMobileFullscreen,
    liked,
    playbackTargetContext,
    progressPct,
  } = usePlayerBarComputedState({
    activeConnectDeviceId,
    activeConnectSession,
    connect,
    crossfadeTransition,
    displayCurrentIndex,
    displayQueue,
    displayTrack,
    effectiveDisplayedDuration,
    effectiveDisplayedTime,
    effectiveVolume,
    fsOpen,
    isDesktop,
    isLiked,
    isBuffering,
    isRemoteConnectActive,
    legacyConnectEnabled,
    pause,
    publishConnectState,
  });

  usePlayerBarExternalSurfaceEffects({
    currentTrackAvailable: !!currentTrack,
    displayTrackAvailable: !!displayTrack,
    fsOpen,
    isDesktop,
    setFsOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
    setShouldRenderFullscreenPlayer,
    setShouldRenderQueuePanel,
  });

  const {
    clearCoverLongPressTimer,
    handleAddToCollection,
    handleCoverTouchEnd,
    handleCoverTouchMove,
    handleCoverTouchStart,
    handleCycleRepeat,
    handleToggleEqualizer,
    handleToggleExtendedPlayer,
    handleToggleLyrics,
    handleToggleQueue,
    handleToggleShuffle,
    isCoverLongPressTriggered,
    openFullscreenPlayer,
    prepareEqualizerPopover,
    prepareExtendedPlayer,
    prepareFullscreenPlayer,
    prepareLyricsPanel,
    prepareQueuePanel,
    resetCoverLongPress,
    toggleLike,
  } = usePlayerBarActions({
    displayTrack,
    isDesktop,
    isRemoteConnectActive,
    jamQueueLocked,
    showQueue,
    showLyrics,
    extendedOpen,
    setShowQueue,
    setShowLyrics,
    setShowEqualizer,
    setExtendedOpen,
    setShouldRenderQueuePanel,
    setShouldRenderLyricsPanel,
    setShouldRenderEqualizerPopover,
    setShouldRenderExtendedPlayer,
    setShouldRenderFullscreenPlayer,
    setFsOpen,
    likeTrack,
    unlikeTrack,
    liked,
    toggleShuffle,
    cycleRepeat,
  });

  usePlayerBarLongPressEffect(clearCoverLongPressTimer);

  return {
    isDesktop,
    liked,
    isShapedRadioTrack,
    effectiveIsPlaying,
    effectiveIsBuffering,
    isPlaying,
    shuffle,
    jamQueueLocked,
    jamTransportDisabled: jamQueueLocked,
    showPlayerBarAnalyzer,
    isRemoteConnectActive,
    extendedOpen,
    allowEqualizer,
    showEqualizer,
    showQueue,
    showLyrics,
    hidePlayerBarForMobileFullscreen,
    hasFloatingOverlayOpen,
    fsOpen,
    shouldRenderQueuePanel,
    shouldRenderLyricsPanel,
    shouldRenderEqualizerPopover,
    shouldRenderExtendedPlayer,
    shouldRenderFullscreenPlayer,
    displayTrack,
    displayCrossfadeTransition,
    crossfadeProgress,
    displayPlaySource,
    sourceLabel,
    shapedRadioSessionId,
    effectiveDisplayedDuration,
    duration,
    onPrepareFullscreen: prepareFullscreenPlayer,
    onOpenFullscreen: openFullscreenPlayer,
    onCoverTouchStart: handleCoverTouchStart,
    onCoverTouchMove: handleCoverTouchMove,
    onCoverTouchEnd: handleCoverTouchEnd,
    isCoverLongPressTriggered,
    resetCoverLongPress,
    onToggleLike: () => void toggleLike(),
    onNextTrack: handleNextTrack,
    onAddToCollection: handleAddToCollection,
    onOverlayChange: setHasFloatingOverlayOpen,
    handleTouchStart,
    handleTouchEnd,
    effectiveDisplayedTime,
    repeat,
    frequenciesDb,
    sampleRate,
    progressPct,
    seekHover,
    onSeekHoverChange: setSeekHover,
    onToggleShuffle: handleToggleShuffle,
    onPreviousTrack: handlePreviousTrack,
    onPlayPause: handlePlayPause,
    onCycleRepeat: handleCycleRepeat,
    onSeek: handleSeek,
    qualityBadge,
    showsDeliveryQuality,
    effectiveVolume,
    onVolumeChange: handleVolumeChange,
    playbackTargetContext,
    displayQueue,
    displayCurrentIndex,
    onToggleEqualizer: handleToggleEqualizer,
    onPrepareEqualizer: prepareEqualizerPopover,
    onToggleQueue: handleToggleQueue,
    onPrepareQueue: prepareQueuePanel,
    onToggleLyrics: handleToggleLyrics,
    onPrepareLyrics: prepareLyricsPanel,
    onToggleExtendedPlayer: handleToggleExtendedPlayer,
    onPrepareExtendedPlayer: prepareExtendedPlayer,
    onCloseQueue: () => setShowQueue(false),
    onCloseLyrics: () => setShowLyrics(false),
    onCloseEqualizer: () => setShowEqualizer(false),
    onCloseExtendedPlayer: () => setExtendedOpen(false),
    onCloseFullscreenPlayer: () => setFsOpen(false),
  };
}
