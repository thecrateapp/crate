import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { api } from "@/lib/api";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import {
  getPlayerSurfaceModePreference,
  PLAYER_VIZ_PREFS_EVENT,
  type PlayerSurfaceMode,
} from "@/lib/player-visualizer-prefs";
import { artistPagePath } from "@/lib/library-routes";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";
import type { FSPanel } from "@/components/player/fullscreen-player-types";
import { useFullscreenPlayerActions } from "@/components/player/useFullscreenPlayerActions";
import { useFullscreenPlayerGestures } from "@/components/player/useFullscreenPlayerGestures";
import { FullscreenPlayerView } from "@/components/player/FullscreenPlayerView";

interface LyricLine {
  time: number;
  text: string;
}

function parseSyncedLyrics(raw: string): LyricLine[] {
  return raw.split("\n").reduce<LyricLine[]>((acc, line) => {
    const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (m)
      acc.push({
        time: +m[1]! * 60 + +m[2]! + +m[3]! / 100,
        text: m[4]!.trim(),
      });
    return acc;
  }, []);
}

function getMobileSurfaceModePreference(): PlayerSurfaceMode {
  const mode = getPlayerSurfaceModePreference();
  return mode === "visualizer" ? "cd" : mode;
}

interface FullscreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({ open, onClose }: FullscreenPlayerProps) {
  const { t } = useTranslation();
  const {
    currentTrack,
    queue,
    currentIndex,
    currentTime,
    duration,
    isBuffering,
    seek,
    jumpTo,
    isPlaying,
    crossfadeTransition,
    playSource,
    shuffle,
    repeat,
  } = usePlayer();
  const {
    pause,
    resume,
    next,
    prev,
    jamQueueLocked,
    setPlaybackRate,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Keep the crossfade visuals, but let time/progress track the live
  // incoming song so the UI does not jump backwards after the fade.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );
  const navigate = useNavigate();
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const equalizerEnabled = useEqualizerEnabled();
  const allowMobileEqualizer =
    equalizerEnabled && (canUseWebAudioEffects || androidNativePlayerEnabled);
  const spinningDiscJogSeekMode = androidNativePlayerEnabled
    ? "commit"
    : "live";

  const [activePanel, setActivePanel] = useState<FSPanel | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<PlayerSurfaceMode>(
    getMobileSurfaceModePreference,
  );
  const [lyrics, setLyrics] = useState<{
    synced: LyricLine[] | null;
    plain: string | null;
  } | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const { resolvedArtist, artistAvatarUrl, markArtistPhotoFailed } =
    useResolvedPlayerArtist(currentTrack, queue);
  const sourceLabel = getPlaySourceLabel(playSource);
  const liked = currentTrack
    ? isLiked(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
        currentTrack.globalTrackUid ?? null,
      )
    : false;
  const jamTransportDisabled = jamQueueLocked;

  const coverRef = useRef<HTMLDivElement>(null);
  const fsRootRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const isCdMode = surfaceMode === "cd";
  const resetClosedUi = useCallback(() => {
    setActivePanel(null);
    setShowEqualizer(false);
    onClose();
  }, [onClose]);

  const {
    closeWithFeedback,
    cycleRepeatWithFeedback,
    goNextWithFeedback,
    goPrevWithFeedback,
    seekWithFeedback,
    toggleLikeWithFeedback,
    togglePlaybackWithFeedback,
    toggleShuffleWithFeedback,
    toggleSurfaceModeWithFeedback,
  } = useFullscreenPlayerActions({
    currentTrack,
    cycleRepeat,
    isPlaying,
    jamQueueLocked,
    next,
    onClose: resetClosedUi,
    pause,
    prev,
    resume,
    seek,
    setSurfaceMode,
    surfaceMode,
    t,
    toggleShuffle,
    toggleTrackLike,
  });
  const { draggingRef, onSwipeEnd, onSwipeMove, onSwipeStart, swipeY } =
    useFullscreenPlayerGestures({
      activePanel,
      goNextWithFeedback,
      goPrevWithFeedback,
      onClose: resetClosedUi,
    });

  // Animate in/out
  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEscapeKey(visible, (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (showEqualizer) {
      setShowEqualizer(false);
      return;
    }
    if (activePanel !== null) {
      setActivePanel(null);
      return;
    }
    resetClosedUi();
  });

  function goToArtist() {
    const targetArtist = resolvedArtist;
    if (!targetArtist?.id && !targetArtist?.globalArtistUid) return;
    resetClosedUi();
    navigate(
      targetArtist.globalArtistUid
        ? artistPagePath({
            artistId: targetArtist.id,
            globalArtistUid: targetArtist.globalArtistUid,
            artistSlug: targetArtist.slug,
            artistName: targetArtist.name,
          })
        : artistPagePath({
            artistId: targetArtist.id,
            artistSlug: targetArtist.slug,
            artistName: targetArtist.name,
          }),
    );
  }

  useEffect(() => {
    const syncSurfaceMode = () =>
      setSurfaceMode(getMobileSurfaceModePreference());
    window.addEventListener("storage", syncSurfaceMode);
    window.addEventListener(
      PLAYER_VIZ_PREFS_EVENT,
      syncSurfaceMode as EventListener,
    );
    return () => {
      window.removeEventListener("storage", syncSurfaceMode);
      window.removeEventListener(
        PLAYER_VIZ_PREFS_EVENT,
        syncSurfaceMode as EventListener,
      );
    };
  }, []);

  // Lyrics fetch
  useEffect(() => {
    if (!visible || activePanel !== "lyrics" || !currentTrack) {
      if (!visible || !currentTrack) setLyrics(null);
      return;
    }
    const controller = new AbortController();
    setLyrics(null);
    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(
        currentTrack.artist || "",
      )}&title=${encodeURIComponent(currentTrack.title || "")}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((d) => {
        if (controller.signal.aborted) return;
        setLyrics({
          synced: d.syncedLyrics ? parseSyncedLyrics(d.syncedLyrics) : null,
          plain: d.plainLyrics || null,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLyrics({ synced: null, plain: null });
      });
    return () => controller.abort();
  }, [
    activePanel,
    visible,
    currentTrack?.id,
    currentTrack?.artist,
    currentTrack?.title,
  ]);

  // Active lyric index
  const activeLyricIndex = lyrics?.synced
    ? (() => {
        for (let i = (lyrics.synced?.length ?? 0) - 1; i >= 0; i--) {
          if (currentTime >= lyrics.synced![i]!.time) return i;
        }
        return -1;
      })()
    : -1;

  // Auto-scroll lyrics
  useEffect(() => {
    if (activePanel !== "lyrics" || !activeLyricRef.current) return;
    activeLyricRef.current.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    });
  }, [activeLyricIndex, activePanel]);

  useDismissibleLayer({
    active: visible && showEqualizer,
    refs: [equalizerRef, equalizerButtonRef],
    onDismiss: () => {
      setShowEqualizer(false);
    },
    closeOnEscape: false,
  });

  const handleNativeBack = useEffectEvent((event: Event) => {
    event.preventDefault();
    if (showEqualizer) {
      setShowEqualizer(false);
      return;
    }
    if (activePanel !== null) {
      setActivePanel(null);
      return;
    }
    resetClosedUi();
  });

  useEffect(() => {
    if (!visible) return;
    window.addEventListener("crate:native-back", handleNativeBack);
    return () =>
      window.removeEventListener("crate:native-back", handleNativeBack);
  }, [visible]);

  if (!visible || !currentTrack) return null;

  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const remainingTime = Math.max(0, displayedDuration - displayedTime);
  const playerTabBottomClearance =
    "var(--listen-mobile-fullscreen-player-clearance)";
  const scrollTabBottomClearance =
    "var(--listen-mobile-fullscreen-scroll-clearance)";

  return (
    <FullscreenPlayerView
      t={t}
      state={{
        activePanel,
        animating,
        allowMobileEqualizer,
        isBuffering,
        isCdMode,
        isPlaying,
        jamQueueLocked,
        jamTransportDisabled,
        liked,
        repeat,
        showEqualizer: allowMobileEqualizer && showEqualizer,
        shuffle,
        surfaceMode,
        swipeY,
      }}
      player={{
        currentTrack,
        crossfadeProgress,
        crossfadeTransition,
        displayedDuration,
        displayedTime,
        duration,
        effectiveRemainingTime: remainingTime,
        resolvedArtist,
        artistAvatarUrl,
        sourceLabel,
        spinningDiscJogSeekMode,
        upcomingTracks,
      }}
      refs={{
        activeLyricRef,
        coverRef,
        equalizerButtonRef,
        equalizerRef,
        fsRootRef,
        lyricsContainerRef,
      }}
      actions={{
        closeWithFeedback,
        cycleRepeatWithFeedback,
        goNextWithFeedback,
        goPrevWithFeedback,
        goToArtist,
        jumpTo: (index) => jumpTo(currentIndex + 1 + index),
        onClose: resetClosedUi,
        onSwipeEnd,
        onSwipeMove,
        onSwipeStart,
        seek,
        seekWithFeedback,
        setDragging: (dragging) => {
          draggingRef.current = dragging;
        },
        setShowEqualizer,
        setPlaybackRate,
        equalizerButtonRef,
        toggleLikeWithFeedback,
        togglePlaybackWithFeedback,
        toggleShuffleWithFeedback,
        toggleSurfaceModeWithFeedback,
      }}
      lyrics={lyrics}
      activeLyricIndex={activeLyricIndex}
      playerTabBottomClearance={playerTabBottomClearance}
      scrollTabBottomClearance={scrollTabBottomClearance}
      onSelectPanel={setActivePanel}
      setShowEqualizer={setShowEqualizer}
      markArtistPhotoFailed={markArtistPhotoFailed}
    />
  );
}
