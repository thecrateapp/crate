import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Settings, SlidersHorizontal } from "@crate/ui/icons";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { CrateImage } from "@/components/artwork/CrateImage";
import { PlayerSurfaceModeSwitch } from "@/components/player/PlayerSurfaceModeSwitch";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import { artistPagePath } from "@/lib/library-routes";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { triggerHaptic } from "@/lib/haptics";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { useVisualizerConfig } from "@/components/player/visualizer/useVisualizerConfig";
import { measureVisualizerCanvasRect } from "@/components/player/visualizer/canvas-layout";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import type { MusicVisualizer } from "@/components/player/visualizer/MusicVisualizer";
import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";

type TabId = "queue" | "suggested" | "lyrics" | "info";

interface ExtendedPlayerProps {
  open: boolean;
  onClose: () => void;
}

const TABS: { id: TabId; labelKey: string }[] = [
  { id: "queue", labelKey: "player.queue" },
  { id: "suggested", labelKey: "player.suggested" },
  { id: "lyrics", labelKey: "player.lyrics" },
  { id: "info", labelKey: "player.info" },
];

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const {
    currentTrack,
    currentTime,
    duration,
    isPlaying,
    isBuffering,
    volume,
    analyserVersion,
    crossfadeTransition,
  } = usePlayer();
  const { pause, resume, playSource, queue, seek, jamQueueLocked } =
    usePlayerActions();
  function toggleDiscPlay() {
    if (jamQueueLocked) return;
    if (isPlaying) pause();
    else resume();
  }
  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );
  const [tab, setTab] = useState<TabId>("queue");
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const equalizerEnabled = useEqualizerEnabled();
  const { resolvedArtist, artistAvatarUrl, markArtistPhotoFailed } =
    useResolvedPlayerArtist(currentTrack, queue);
  const sourceLabel = getPlaySourceLabel(playSource);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const vizSettingsRef = useRef<HTMLDivElement>(null);
  const vizSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const vizRef = useRef<MusicVisualizer | null>(null);
  const playbackState = useMemo(
    () => ({ isPlaying, volume }),
    [isPlaying, volume],
  );
  const vizCfg = useVisualizerConfig(
    vizRef,
    currentTrack,
    open && isDesktop,
    crossfadeTransition,
  );
  const isCdMode = vizCfg.surfaceMode === "cd";
  const isVisualizerMode = vizCfg.surfaceMode === "visualizer";

  useEffect(() => {
    if (!equalizerEnabled) setShowEqualizer(false);
  }, [equalizerEnabled]);

  const [canvasRect, setCanvasRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    referenceSize: number;
  } | null>(null);
  useMusicVisualizer(
    canvasRef,
    `${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
    open && isDesktop && isVisualizerMode && canvasRect != null,
    playbackState,
    "spheres",
    vizRef,
  );

  // Measure cover position relative to the left panel and give the WebGL
  // canvas a bit more breathing room than the visualizer itself needs.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const measure = () => {
      const cover = coverRef.current;
      const panel = panelRef.current;
      if (!cover || !panel) return;
      const cr = cover.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      // Skip measurement if panel is still animating (off-screen)
      if (pr.top > window.innerHeight * 0.5) return;
      setCanvasRect(
        measureVisualizerCanvasRect(cr, pr, {
          baseScale: 1.4,
          edgePadding: 20,
        }),
      );
    };
    // Wait for open animation to settle before first measure
    const t1 = window.setTimeout(measure, 550);
    const resizeObs = new ResizeObserver(measure);
    if (coverRef.current) resizeObs.observe(coverRef.current);
    if (panelRef.current) resizeObs.observe(panelRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t1);
      resizeObs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, isDesktop, showVizSettings, vizCfg.surfaceMode]);

  useDismissibleLayer({
    active: showVizSettings || showEqualizer,
    refs: [
      vizSettingsRef,
      vizSettingsButtonRef,
      equalizerRef,
      equalizerButtonRef,
    ],
    onDismiss: () => {
      setShowVizSettings(false);
      setShowEqualizer(false);
    },
    closeOnEscape: false,
  });

  useEffect(() => {
    if (!isVisualizerMode && showVizSettings) {
      setShowVizSettings(false);
    }
  }, [isVisualizerMode, showVizSettings]);

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showVizSettings) {
        setShowVizSettings(false);
        return;
      }
      if (showEqualizer) {
        setShowEqualizer(false);
        return;
      }
      onClose();
    },
    [onClose, showEqualizer, showVizSettings],
  );

  useEscapeKey(open, handleEscape);

  if (!isDesktop || !currentTrack) return null;

  function closeWithFeedback() {
    triggerHaptic("selection");
    onClose();
  }

  function goToArtist() {
    if (!resolvedArtist?.id && !resolvedArtist?.globalArtistUid) return;
    navigate(
      resolvedArtist.globalArtistUid
        ? artistPagePath({
            artistId: resolvedArtist.id,
            globalArtistUid: resolvedArtist.globalArtistUid,
            artistSlug: resolvedArtist.slug,
            artistName: resolvedArtist.name,
          })
        : artistPagePath({
            artistId: resolvedArtist.id,
            artistSlug: resolvedArtist.slug,
            artistName: resolvedArtist.name,
          }),
    );
  }

  return (
    <div
      className={`z-app-extended-player fixed inset-0 flex bg-app-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform ${
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div
        ref={panelRef}
        className="relative flex w-1/2 flex-col items-center justify-center overflow-hidden bg-app-surface"
      >
        <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
          <button
            onClick={closeWithFeedback}
            aria-label={t("player.close")}
            className="rounded-full bg-surface-control p-2 text-text-secondary backdrop-blur-sm transition-colors hover:bg-surface-control-hover hover:text-text-primary"
          >
            <ChevronDown size={20} />
          </button>
          <div className="flex items-center gap-2">
            <PlayerSurfaceModeSwitch
              mode={vizCfg.surfaceMode}
              onChange={(mode) => {
                vizCfg.setSurfaceMode(mode);
                if (mode !== "visualizer") setShowVizSettings(false);
              }}
            />
            {equalizerEnabled ? (
              <button
                ref={equalizerButtonRef}
                onClick={() => {
                  setShowEqualizer((value) => !value);
                  setShowVizSettings(false);
                }}
                aria-label={t("player.equalizer")}
                className={`rounded-full p-2 backdrop-blur-sm transition-colors ${
                  showEqualizer
                    ? "bg-accent-action/18 text-accent-action drop-shadow-[0_0_8px_var(--accent-action-glow)]"
                    : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary"
                }`}
              >
                <SlidersHorizontal size={18} />
              </button>
            ) : null}
            <button
              ref={vizSettingsButtonRef}
              onClick={() => setShowVizSettings(!showVizSettings)}
              aria-label={t("player.visualizerSettings")}
              disabled={!isVisualizerMode}
              className={`rounded-full p-2 backdrop-blur-sm transition-colors ${
                !isVisualizerMode
                  ? "bg-surface-icon-control text-text-faint"
                  : showVizSettings
                    ? "bg-accent-action/18 text-accent-action drop-shadow-[0_0_8px_var(--accent-action-glow)]"
                    : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary"
              }`}
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        {showVizSettings ? (
          <AppPopover
            ref={vizSettingsRef}
            className="absolute top-14 right-4 w-56 p-4"
          >
            <VisualizerSettingsPanel config={vizCfg} />
          </AppPopover>
        ) : null}

        {equalizerEnabled && showEqualizer ? (
          <AppPopover
            ref={equalizerRef}
            className="absolute top-14 right-4 w-[480px] max-w-[min(480px,calc(100%-2rem))] p-4"
          >
            <EqualizerPanel onClose={() => setShowEqualizer(false)} />
          </AppPopover>
        ) : null}

        <div
          ref={coverRef}
          className="relative z-0 aspect-square w-[72%] max-w-[500px] shrink-0"
        >
          {isCdMode ? (
            <SpinningDisc
              albumCover={currentTrack.albumCover}
              className="w-full"
              crossfadeIncomingCover={crossfadeTransition?.incoming.albumCover}
              crossfadeOutgoingCover={crossfadeTransition?.outgoing.albumCover}
              crossfadeProgress={crossfadeProgress}
              currentTime={displayedTime}
              duration={displayedDuration}
              isBuffering={isBuffering}
              isPlaying={isPlaying}
              disabled={jamQueueLocked}
              onTogglePlay={toggleDiscPlay}
            />
          ) : (
            <>
              <div className="absolute inset-6 rounded-xl bg-accent-action/10 opacity-70 blur-3xl" />
              <div className="absolute inset-2 rounded-xl border border-surface-quiet bg-surface-quiet-subtle" />
              {crossfadeTransition ? (
                <>
                  {crossfadeTransition.outgoing.albumCover ? (
                    <CrateImage
                      src={crossfadeTransition.outgoing.albumCover}
                      alt=""
                      className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
                      style={{
                        filter: isVisualizerMode
                          ? "grayscale(100%) brightness(0.35)"
                          : "none",
                        opacity: 1 - crossfadeProgress,
                      }}
                    />
                  ) : null}
                  {crossfadeTransition.incoming.albumCover ? (
                    <CrateImage
                      src={crossfadeTransition.incoming.albumCover}
                      alt=""
                      className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
                      style={{
                        filter: isVisualizerMode
                          ? "grayscale(100%) brightness(0.35)"
                          : "none",
                        opacity: crossfadeProgress,
                      }}
                    />
                  ) : null}
                </>
              ) : currentTrack.albumCover ? (
                <CrateImage
                  src={currentTrack.albumCover}
                  alt=""
                  className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
                  style={{
                    filter: isVisualizerMode
                      ? "grayscale(100%) brightness(0.35)"
                      : "none",
                  }}
                />
              ) : (
                <div className="absolute inset-0 rounded-xl bg-surface-quiet-subtle shadow-[0_28px_100px_rgba(0,0,0,0.75)]" />
              )}
            </>
          )}
        </div>

        {/* WebGL canvas — slightly larger than the visualizer’s visual footprint,
            with extra room from the container to avoid clipping on big pulses. */}
        <div
          className={`pointer-events-none absolute ${
            showVizSettings ? "z-30" : "z-10"
          } ${isVisualizerMode && canvasRect ? "" : "hidden"}`}
          style={
            canvasRect
              ? {
                  top: canvasRect.top,
                  left: canvasRect.left,
                  width: canvasRect.width,
                  height: canvasRect.height,
                }
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            data-viz-reference-size={
              canvasRect ? String(canvasRect.referenceSize) : undefined
            }
            style={{ background: "transparent" }}
          />
        </div>

        <div className="relative z-20 mt-6 max-w-full px-8 text-center">
          <PlayerTrackIdentity
            currentTrack={currentTrack}
            crossfadeTransition={crossfadeTransition}
            crossfadeProgress={crossfadeProgress}
            sourceLabel={sourceLabel}
            artistAvatarUrl={artistAvatarUrl}
            onArtistAvatarError={markArtistPhotoFailed}
            onArtistClick={goToArtist}
            artistClickable={!!resolvedArtist?.id}
            titleClassName="text-xl leading-tight"
            albumClassName="text-sm"
          />
          {vizCfg.trackVizProfile.hasAnalysis &&
          vizCfg.trackVizProfile.summary ? (
            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.22em] text-text-muted">
              {vizCfg.trackVizProfile.summary}
            </p>
          ) : null}
          <PlayerSeekBar
            className="mx-auto mt-5 w-full max-w-[420px]"
            currentTime={displayedTime}
            duration={displayedDuration}
            onSeek={seek}
            disabled={jamQueueLocked}
            showTimes
            variant="glow"
          />
        </div>
      </div>

      <div className="flex w-1/2 flex-col bg-app-surface">
        <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                triggerHaptic("selection");
                setTab(item.id);
              }}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                tab === item.id
                  ? "bg-surface-control text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
          {tab === "queue" && <QueueTab />}
          {tab === "suggested" && <SuggestedTab />}
          {tab === "lyrics" && (
            <LyricsTab useAlbumPalette={vizCfg.useAlbumPalette} />
          )}
          {tab === "info" && <InfoTab />}
        </div>
      </div>
    </div>
  );
}
