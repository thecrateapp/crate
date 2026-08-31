import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import { SpectrumPlayButton } from "@/components/player/SpectrumPlayButton";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { CrateImage } from "@/components/artwork/CrateImage";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { api } from "@/lib/api";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import {
  getPlayerSurfaceModePreference,
  PLAYER_VIZ_PREFS_EVENT,
  setPlayerSurfaceModePreference,
  type PlayerSurfaceMode,
} from "@/lib/player-visualizer-prefs";
import {
  ChevronDown,
  ListMusic,
  Disc3,
  Heart,
  HeartBold,
  Info,
  Loader2,
  Mic3,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Square,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { artistPagePath } from "@/lib/library-routes";
import {
  usePlayer,
  usePlayerActions,
  type Track,
} from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { cn } from "@crate/ui/lib/cn";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";
import { toast } from "sonner";
import { triggerHaptic } from "@/lib/haptics";

type FSPanel = "queue" | "lyrics" | "info";

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

function FullscreenQueueRow({
  track,
  onJump,
}: {
  track: Track;
  onJump: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onJump,
  });
  const actionMenu = useItemActionMenu(actions);

  function jumpWithFeedback() {
    triggerHaptic("selection");
    onJump();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={jumpWithFeedback}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpWithFeedback();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="flex w-full items-center gap-3 rounded-lg py-2 text-left transition-colors active:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
    >
      {track.albumCover ? (
        <CrateImage
          src={track.albumCover}
          alt=""
          loading="lazy"
          className="w-8 h-8 rounded object-cover shrink-0"
        />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-surface-control-hover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm text-text-primary">
            {track.title}
          </p>
          {track.isSuggested ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-action">
              Suggested
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-text-muted">{track.artist}</p>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-11 w-11 shrink-0 opacity-85 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: track.albumCover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
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
  const [swipeY, setSwipeY] = useState(0);
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

  const swipeStartRef = useRef<number | null>(null);
  const horizontalSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeYRef = useRef(0);
  const swipeFrameRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const coverRef = useRef<HTMLDivElement>(null);
  const fsRootRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const isCdMode = surfaceMode === "cd";

  useEffect(() => {
    if (!allowMobileEqualizer) setShowEqualizer(false);
  }, [allowMobileEqualizer]);

  function closeWithFeedback() {
    triggerHaptic("selection");
    onClose();
  }

  function togglePlaybackWithFeedback() {
    triggerHaptic("light");
    if (jamQueueLocked) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }

  async function toggleLikeWithFeedback() {
    if (!currentTrack) return;
    triggerHaptic("selection");
    try {
      const nextLiked = await toggleTrackLike(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
        currentTrack.globalTrackUid ?? null,
      );
      toast.success(
        nextLiked
          ? t("actions.track.toasts.liked")
          : t("actions.track.toasts.unliked"),
      );
    } catch {
      toast.error(t("player.toasts.updateLikedTracksFailed"));
    }
  }

  function goNextWithFeedback() {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    next();
  }

  function goPrevWithFeedback() {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    prev();
  }

  function seekWithFeedback(time: number) {
    if (jamQueueLocked) return;
    seek(time);
  }

  function toggleShuffleWithFeedback() {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    toggleShuffle();
  }

  function cycleRepeatWithFeedback() {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    cycleRepeat();
  }

  function toggleSurfaceModeWithFeedback() {
    triggerHaptic("selection");
    const nextMode = surfaceMode === "cd" ? "cover" : "cd";
    setSurfaceMode(nextMode);
    setPlayerSurfaceModePreference(nextMode);
  }

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
    onClose();
  });

  function goToArtist() {
    const targetArtist = resolvedArtist;
    if (!targetArtist?.id && !targetArtist?.globalArtistUid) return;
    onClose();
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

  // Reset tab when player closes
  useEffect(() => {
    if (visible) return;
    setActivePanel(null);
    swipeYRef.current = 0;
    setSwipeY(0);
    setShowEqualizer(false);
  }, [visible]);

  useDismissibleLayer({
    active: visible && showEqualizer,
    refs: [equalizerRef, equalizerButtonRef],
    onDismiss: () => {
      setShowEqualizer(false);
    },
    closeOnEscape: false,
  });

  useEffect(() => {
    if (!visible) return;
    const handleNativeBack = (event: Event) => {
      event.preventDefault();
      if (showEqualizer) {
        setShowEqualizer(false);
        return;
      }
      if (activePanel !== null) {
        setActivePanel(null);
        return;
      }
      onClose();
    };
    window.addEventListener("crate:native-back", handleNativeBack);
    return () =>
      window.removeEventListener("crate:native-back", handleNativeBack);
  }, [activePanel, onClose, showEqualizer, visible]);

  useEffect(
    () => () => {
      if (swipeFrameRef.current != null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
      }
    },
    [],
  );

  const scheduleSwipeY = useCallback((nextY: number) => {
    swipeYRef.current = nextY;
    if (swipeFrameRef.current != null) return;
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null;
      setSwipeY(swipeYRef.current);
    });
  }, []);

  // Swipe-down to dismiss from the upper part of the sheet.
  const onSwipeStart = useCallback(
    (e: React.TouchEvent) => {
      if (draggingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const startX = touch.clientX;
      const startY = touch.clientY;
      const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
      horizontalSwipeStartRef.current =
        activePanel === null ? { x: startX, y: startY } : null;
      if (startY - el.top > Math.min(260, el.height * 0.35)) return;
      swipeStartRef.current = startY;
    },
    [activePanel],
  );
  const onSwipeMove = useCallback(
    (e: React.TouchEvent) => {
      if (swipeStartRef.current === null || draggingRef.current) return;
      const dy = e.touches[0]!.clientY - swipeStartRef.current;
      scheduleSwipeY(dy > 0 ? Math.min(dy * 0.6, 300) : 0);
    },
    [scheduleSwipeY],
  );
  const onSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      const horizontalStart = horizontalSwipeStartRef.current;
      horizontalSwipeStartRef.current = null;

      if (horizontalStart && activePanel === null && !draggingRef.current) {
        const touch = e.changedTouches[0];
        if (touch) {
          const action = getHorizontalPlayerSwipeAction({
            deltaX: touch.clientX - horizontalStart.x,
            deltaY: touch.clientY - horizontalStart.y,
            viewportWidth: window.innerWidth,
          });
          if (action) {
            if (action === "next") {
              goNextWithFeedback();
            } else {
              goPrevWithFeedback();
            }
            scheduleSwipeY(0);
            swipeStartRef.current = null;
            return;
          }
        }
      }

      if (swipeYRef.current > 100) {
        triggerHaptic("selection");
        onClose();
      }
      scheduleSwipeY(0);
      swipeStartRef.current = null;
    },
    [
      activePanel,
      goNextWithFeedback,
      goPrevWithFeedback,
      onClose,
      scheduleSwipeY,
    ],
  );

  if (!visible || !currentTrack) return null;

  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const remainingTime = Math.max(0, displayedDuration - displayedTime);
  const playerTabBottomClearance =
    "var(--listen-mobile-fullscreen-player-clearance)";
  const scrollTabBottomClearance =
    "var(--listen-mobile-fullscreen-scroll-clearance)";

  const PANEL_SWITCHES: { id: FSPanel; icon: typeof Disc3; label: string }[] = [
    { id: "queue", icon: ListMusic, label: t("player.queue") },
    { id: "lyrics", icon: Mic3, label: t("player.lyrics") },
    { id: "info", icon: Info, label: t("player.info") },
  ];

  return (
    <div
      ref={fsRootRef}
      className={`fullscreen-player-surface fixed inset-0 z-fullscreen-player flex flex-col ease-out ${
        animating ? "opacity-100" : "opacity-0 translate-y-full"
      }`}
      style={{
        minHeight: "var(--listen-viewport-height)",
        height: "var(--listen-viewport-height)",
        transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
        transition: swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity: swipeY > 0 ? Math.max(0.3, 1 - swipeY / 400) : undefined,
      }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      {/* Drag handle */}
      <div
        className="flex justify-center pb-1"
        style={{ paddingTop: "calc(var(--listen-safe-top) + 0.75rem)" }}
      >
        <div className="fullscreen-player-handle h-1 w-10 rounded-full" />
      </div>

      {/* Header: close + panel switches */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          onClick={closeWithFeedback}
          aria-label={t("player.close")}
          className="flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center -ml-2 text-text-secondary active:text-text-primary"
        >
          <ChevronDown size={28} />
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          {PANEL_SWITCHES.map(({ id, icon: Icon, label }) => {
            const selected = activePanel === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={selected}
                onClick={() => {
                  triggerHaptic("selection");
                  setActivePanel((current) => (current === id ? null : id));
                }}
                className={cn(
                  "group relative flex h-14 min-w-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold leading-none transition-[color,filter,transform] active:scale-[0.96]",
                  selected
                    ? "text-accent-action drop-shadow-accent-action-icon"
                    : "text-text-muted active:text-text-secondary",
                )}
              >
                <Icon
                  size={CRATE_ICON_SIZE.xl}
                  className="transition-transform group-active:scale-95"
                />
                <span>{label}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-0 h-0.5 w-4 rounded-full transition-[opacity,box-shadow]",
                    selected
                      ? "bg-accent-action opacity-100 shadow-accent-action-indicator-active"
                      : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {allowMobileEqualizer && showEqualizer && (
        <div
          ref={equalizerRef}
          className="listen-mobile-eq-glass absolute left-4 right-4 z-40 overflow-y-auto rounded-xl p-4 animate-fade-slide-up"
          style={{
            top: "var(--listen-mobile-fullscreen-eq-top)",
            maxHeight:
              "calc(var(--listen-viewport-height) - var(--listen-mobile-fullscreen-eq-top) - var(--listen-safe-bottom) - 1rem)",
          }}
        >
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </div>
      )}

      {/* ── Player tab ── */}
      {activePanel === null && (
        <div
          className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-6"
          style={{ paddingBottom: playerTabBottomClearance }}
        >
          <div className="relative z-10 mx-auto w-full max-w-[360px]">
            <div ref={coverRef} className="relative">
              {isCdMode ? (
                <SpinningDisc
                  albumCover={currentTrack.albumCover}
                  className="w-full"
                  crossfadeIncomingCover={
                    crossfadeTransition?.incoming.albumCover
                  }
                  crossfadeOutgoingCover={
                    crossfadeTransition?.outgoing.albumCover
                  }
                  crossfadeProgress={crossfadeProgress}
                  currentTime={displayedTime}
                  duration={displayedDuration}
                  isBuffering={isBuffering}
                  isPlaying={isPlaying}
                  disabled={jamQueueLocked}
                  jogEnabled
                  jogSeekMode={spinningDiscJogSeekMode}
                  onJoggingChange={(jogging) => {
                    draggingRef.current = jogging;
                  }}
                  onPlaybackRateChange={setPlaybackRate}
                  onSeek={seekWithFeedback}
                  onTogglePlay={togglePlaybackWithFeedback}
                />
              ) : (
                <div className="relative aspect-square overflow-hidden rounded-xl">
                  {crossfadeTransition ? (
                    <>
                      {crossfadeTransition.outgoing.albumCover ? (
                        <CrateImage
                          src={crossfadeTransition.outgoing.albumCover}
                          alt=""
                          className="fullscreen-player-artwork absolute inset-0 h-full w-full object-cover"
                          style={{
                            opacity: 1 - crossfadeProgress,
                          }}
                        />
                      ) : null}
                      {crossfadeTransition.incoming.albumCover ? (
                        <CrateImage
                          src={crossfadeTransition.incoming.albumCover}
                          alt=""
                          className="fullscreen-player-artwork absolute inset-0 h-full w-full object-cover"
                          style={{
                            opacity: crossfadeProgress,
                          }}
                        />
                      ) : null}
                    </>
                  ) : currentTrack.albumCover ? (
                    <CrateImage
                      src={currentTrack.albumCover}
                      alt=""
                      className="fullscreen-player-artwork h-full w-full object-cover"
                    />
                  ) : (
                    <div className="fullscreen-player-artwork-placeholder flex h-full w-full items-center justify-center">
                      <ListMusic
                        size={64}
                        className="fullscreen-player-artwork-icon"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Track info */}
          <div className="relative z-10 w-full mt-5 text-center">
            <PlayerTrackIdentity
              currentTrack={currentTrack}
              crossfadeTransition={crossfadeTransition}
              crossfadeProgress={crossfadeProgress}
              sourceLabel={sourceLabel}
              artistAvatarUrl={artistAvatarUrl}
              onArtistAvatarError={markArtistPhotoFailed}
              onArtistClick={goToArtist}
              artistClickable={!!resolvedArtist?.id}
              titleClassName="text-lg"
              albumClassName="text-xs"
            />
            <div className="mx-auto mt-4 w-full max-w-[360px]">
              <div className="fullscreen-player-time mb-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums">
                <span>{formatPlayerTime(displayedTime)}</span>
                <span>-{formatPlayerTime(remainingTime)}</span>
              </div>
              <PlayerSeekBar
                currentTime={displayedTime}
                duration={displayedDuration}
                onSeek={seekWithFeedback}
                disabled={jamQueueLocked}
                thin
                variant="glow"
              />
            </div>

            <div className="mx-auto mt-5 flex w-full max-w-[360px] items-center justify-center gap-3">
              <button
                onClick={toggleShuffleWithFeedback}
                disabled={jamQueueLocked}
                aria-label={
                  shuffle
                    ? t("player.disableShuffle")
                    : t("player.enableShuffle")
                }
                className={`flex h-12 w-12 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-surface-control disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
                  shuffle
                    ? "text-accent-action drop-shadow-accent-action"
                    : "text-text-muted active:text-text-secondary"
                }`}
              >
                <Shuffle size={CRATE_ICON_SIZE.lg} />
              </button>
              <button
                onClick={goPrevWithFeedback}
                disabled={jamQueueLocked}
                aria-label={t("player.previous")}
                className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-text-secondary transition-colors active:bg-surface-control active:text-text-primary disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40"
              >
                <SkipBack size={CRATE_ICON_SIZE.xl} fill="currentColor" />
              </button>
              <SpectrumPlayButton
                onClick={togglePlaybackWithFeedback}
                disabled={jamTransportDisabled}
                aria-label={isPlaying ? t("player.pause") : t("player.play")}
                size="lg"
                active={isPlaying}
                className="touch-manipulation disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
              >
                {isBuffering ? (
                  <Loader2
                    size={CRATE_ICON_SIZE.xl}
                    className="animate-spin text-accent-action"
                  />
                ) : isPlaying ? (
                  <Pause size={26} className="text-text-primary" />
                ) : (
                  <Play
                    size={26}
                    className="ml-1 text-text-primary"
                    fill="currentColor"
                  />
                )}
              </SpectrumPlayButton>
              <button
                onClick={goNextWithFeedback}
                disabled={jamTransportDisabled}
                aria-label={t("player.next")}
                className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-text-secondary transition-colors active:bg-surface-control active:text-text-primary disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40"
              >
                <SkipForward size={CRATE_ICON_SIZE.xl} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeatWithFeedback}
                disabled={jamQueueLocked}
                aria-label={t("player.repeat", { mode: repeat })}
                className={`flex h-12 w-12 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-surface-control disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
                  repeat !== "off"
                    ? "text-accent-action drop-shadow-accent-action"
                    : "text-text-muted active:text-text-secondary"
                }`}
              >
                {repeat === "one" ? (
                  <Repeat1 size={CRATE_ICON_SIZE.lg} />
                ) : (
                  <Repeat size={CRATE_ICON_SIZE.lg} />
                )}
              </button>
            </div>

            <div className="mx-auto mt-3 flex w-full max-w-[360px] items-center justify-center gap-2">
              <button
                onClick={() => {
                  void toggleLikeWithFeedback();
                }}
                aria-label={liked ? "Unlike track" : "Like track"}
                className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
              >
                {liked ? (
                  <HeartBold
                    size={19}
                    className="animate-crate-icon-active-pulse text-accent-action drop-shadow-accent-action"
                  />
                ) : (
                  <Heart size={19} />
                )}
              </button>
              {allowMobileEqualizer ? (
                <button
                  ref={equalizerButtonRef}
                  onClick={() => {
                    triggerHaptic("selection");
                    setShowEqualizer((v) => !v);
                  }}
                  aria-label={t("player.equalizer")}
                  className={`flex h-12 w-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control transition-colors active:bg-surface-control-hover ${
                    showEqualizer
                      ? "text-accent-action drop-shadow-accent-action"
                      : "text-text-secondary active:text-text-primary"
                  }`}
                >
                  <SlidersHorizontal size={CRATE_ICON_SIZE.lg} />
                </button>
              ) : null}
              <button
                onClick={toggleSurfaceModeWithFeedback}
                aria-label={
                  surfaceMode === "cd" ? "Show album cover" : "Show spinning CD"
                }
                title={
                  surfaceMode === "cd" ? "Show album cover" : "Show spinning CD"
                }
                className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
              >
                {surfaceMode === "cd" ? (
                  <Square size={CRATE_ICON_SIZE.lg} />
                ) : (
                  <Disc3 size={CRATE_ICON_SIZE.lg} />
                )}
              </button>
              <PlayerTrackMenu
                currentTrack={currentTrack}
                className="h-12 w-12 rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Queue tab ── */}
      {activePanel === "queue" && (
        <div
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: scrollTabBottomClearance }}
        >
          <div className="px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              {t("player.queue.upNextTracks", {
                count: upcomingTracks.length,
              })}
            </p>
            {upcomingTracks.length === 0 && (
              <p className="py-2 text-sm text-text-faint">
                {t("player.queue.nothingQueued")}
              </p>
            )}
            {upcomingTracks.map((track, i) => {
              const queueIndex = currentIndex + 1 + i;
              return (
                <FullscreenQueueRow
                  key={`${track.id}-${queueIndex}`}
                  track={track}
                  onJump={() => jumpTo(queueIndex)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Lyrics tab ── */}
      {activePanel === "lyrics" && (
        <div
          ref={lyricsContainerRef}
          className="relative flex-1 overflow-y-auto px-5 py-4"
          style={{ paddingBottom: scrollTabBottomClearance }}
        >
          <div
            aria-hidden="true"
            className="lyrics-fullscreen-backdrop pointer-events-none absolute inset-0 opacity-70"
          />
          {!lyrics ? (
            <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
              {t("player.lyrics.loading")}
            </p>
          ) : lyrics.synced ? (
            <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-start gap-3 py-8">
              {lyrics.synced.map((line, i) => {
                const active = i === activeLyricIndex;
                const past = i < activeLyricIndex;

                return (
                  <button
                    key={i}
                    ref={active ? activeLyricRef : null}
                    onClick={() => {
                      triggerHaptic("selection");
                      seek(line.time);
                    }}
                    className={cn(
                      "w-full rounded-xl px-1 py-1 text-left font-extrabold tracking-normal transition-[color,filter,opacity,transform] duration-500",
                      active
                        ? "lyrics-active-line text-[1.9rem] leading-[1.08] text-text-primary opacity-100"
                        : past
                          ? "text-[1.55rem] leading-[1.12] text-text-faint opacity-75 blur-[0.7px]"
                          : "text-[1.55rem] leading-[1.12] text-text-subtle opacity-85 blur-[0.35px]",
                    )}
                  >
                    {line.text || "♪"}
                  </button>
                );
              })}
            </div>
          ) : lyrics.plain ? (
            <pre className="relative z-10 mx-auto max-w-[560px] whitespace-pre-wrap py-8 text-left text-[1.45rem] font-extrabold leading-[1.16] text-text-primary">
              {lyrics.plain}
            </pre>
          ) : (
            <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
              {t("player.lyrics.unavailable")}
            </p>
          )}
        </div>
      )}

      {activePanel === "info" && (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3"
          style={{ paddingBottom: scrollTabBottomClearance }}
        >
          <InfoTab className="pr-0" />
        </div>
      )}
    </div>
  );
}
