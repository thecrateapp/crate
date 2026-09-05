import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TFunction } from "i18next";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { ChevronDown, Settings, SlidersHorizontal } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

import { CrateImage } from "@/components/artwork/CrateImage";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { PlayerSurfaceModeSwitch } from "@/components/player/PlayerSurfaceModeSwitch";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import type { VisualizerConfigState } from "@/components/player/visualizer/useVisualizerConfig";
import type { VisualizerCanvasRect } from "@/components/player/visualizer/canvas-layout";
import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import { triggerHaptic } from "@/lib/haptics";

export type ExtendedPlayerTabId = "queue" | "suggested" | "lyrics" | "info";

const TABS: { id: ExtendedPlayerTabId; labelKey: string }[] = [
  { id: "queue", labelKey: "player.queue" },
  { id: "suggested", labelKey: "player.suggested" },
  { id: "lyrics", labelKey: "player.lyrics" },
  { id: "info", labelKey: "player.info" },
];

type ExtendedPlayerViewState = {
  currentTrack: Track;
  artistClickable: boolean;
  crossfadeProgress: number;
  crossfadeTransition: CrossfadeTransition | null;
  displayedDuration: number;
  displayedTime: number;
  isBuffering: boolean;
  isPlaying: boolean;
  jamQueueLocked: boolean;
  showEqualizer: boolean;
  showVizSettings: boolean;
  tab: ExtendedPlayerTabId;
  volume: number;
  canvasRect: VisualizerCanvasRect | null;
  vizCfg: VisualizerConfigState;
  equalizerEnabled: boolean;
};

type ExtendedPlayerViewRefs = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  coverRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  equalizerRef: RefObject<HTMLDivElement | null>;
  equalizerButtonRef: RefObject<HTMLButtonElement | null>;
  vizSettingsRef: RefObject<HTMLDivElement | null>;
  vizSettingsButtonRef: RefObject<HTMLButtonElement | null>;
};

type ExtendedPlayerViewActions = {
  closeWithFeedback: () => void;
  goToArtist: () => void;
  onSurfaceModeChange: (mode: PlayerSurfaceMode) => void;
  onTabChange: (tab: ExtendedPlayerTabId) => void;
  seek: (time: number) => void;
  setShowEqualizer: Dispatch<SetStateAction<boolean>>;
  setShowVizSettings: Dispatch<SetStateAction<boolean>>;
  toggleDiscPlay: () => void;
};

type ExtendedPlayerViewProps = {
  actions: ExtendedPlayerViewActions;
  refs: ExtendedPlayerViewRefs;
  state: ExtendedPlayerViewState;
  t: TFunction;
  artistAvatarUrl: string | null;
  sourceLabel: string | null;
  markArtistPhotoFailed: () => void;
  open: boolean;
};

function ExtendedPlayerHeader({
  actions,
  refs,
  state,
  t,
}: Pick<ExtendedPlayerViewProps, "actions" | "refs" | "state" | "t">) {
  const showVizSettings =
    state.vizCfg.surfaceMode === "visualizer" && state.showVizSettings;
  const showEqualizer = state.equalizerEnabled && state.showEqualizer;

  return (
    <>
      <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
        <button
          type="button"
          onClick={actions.closeWithFeedback}
          aria-label={t("player.close")}
          className="rounded-full bg-surface-control p-2 text-text-secondary backdrop-blur-sm transition-colors hover:bg-surface-control-hover hover:text-text-primary"
        >
          <ChevronDown size={20} />
        </button>
        <div className="flex items-center gap-2">
          <PlayerSurfaceModeSwitch
            mode={state.vizCfg.surfaceMode}
            onChange={actions.onSurfaceModeChange}
          />
          {state.equalizerEnabled ? (
            <button
              type="button"
              ref={refs.equalizerButtonRef}
              onClick={() => {
                actions.setShowVizSettings(false);
                actions.setShowEqualizer((value) => !value);
              }}
              aria-label={t("player.equalizer")}
              className={cn(
                "rounded-full p-2 backdrop-blur-sm transition-colors",
                state.showEqualizer
                  ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                  : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
              )}
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : null}
          <button
            type="button"
            ref={refs.vizSettingsButtonRef}
            onClick={() => actions.setShowVizSettings((value) => !value)}
            aria-label={t("player.visualizerSettings")}
            disabled={state.vizCfg.surfaceMode !== "visualizer"}
            className={cn(
              "rounded-full p-2 backdrop-blur-sm transition-colors",
              state.vizCfg.surfaceMode !== "visualizer"
                ? "bg-surface-icon-control text-text-faint"
                : state.showVizSettings
                  ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                  : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
            )}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      {showVizSettings ? (
        <AppPopover
          ref={refs.vizSettingsRef}
          className="absolute top-14 right-4 z-30 w-56 p-4"
        >
          <VisualizerSettingsPanel config={state.vizCfg} />
        </AppPopover>
      ) : null}
      {showEqualizer ? (
        <AppPopover
          ref={refs.equalizerRef}
          className="absolute top-14 right-4 z-30 w-[480px] max-w-[min(480px,calc(100%-2rem))] p-4"
        >
          <EqualizerPanel onClose={() => actions.setShowEqualizer(false)} />
        </AppPopover>
      ) : null}
    </>
  );
}

function ExtendedPlayerCover({
  actions,
  refs,
  state,
}: Pick<ExtendedPlayerViewProps, "actions" | "refs" | "state">) {
  const isCdMode = state.vizCfg.surfaceMode === "cd";
  const { currentTrack, crossfadeTransition } = state;

  return (
    <div
      ref={refs.coverRef}
      className="relative z-0 aspect-square w-[72%] max-w-[500px] shrink-0"
    >
      {isCdMode ? (
        <SpinningDisc
          albumCover={currentTrack.albumCover}
          className="w-full"
          crossfadeIncomingCover={crossfadeTransition?.incoming.albumCover}
          crossfadeOutgoingCover={crossfadeTransition?.outgoing.albumCover}
          crossfadeProgress={state.crossfadeProgress}
          currentTime={state.displayedTime}
          duration={state.displayedDuration}
          isBuffering={state.isBuffering}
          isPlaying={state.isPlaying}
          disabled={state.jamQueueLocked}
          onTogglePlay={actions.toggleDiscPlay}
        />
      ) : (
        <ExtendedPlayerCoverArt state={state} />
      )}
    </div>
  );
}

function ExtendedPlayerCoverArt({
  state,
}: Pick<ExtendedPlayerViewProps, "state">) {
  const isVisualizerMode = state.vizCfg.surfaceMode === "visualizer";
  const { currentTrack, crossfadeTransition } = state;
  const imageStyle = {
    filter: isVisualizerMode ? "grayscale(100%) brightness(0.35)" : "none",
  };

  return (
    <>
      <div className="absolute inset-6 rounded-xl bg-accent-action/10 opacity-70 blur-3xl" />
      <div className="absolute inset-2 rounded-xl border border-border-quiet bg-surface-quiet-subtle" />
      {crossfadeTransition ? (
        <>
          {crossfadeTransition.outgoing.albumCover ? (
            <CrateImage
              src={crossfadeTransition.outgoing.albumCover}
              alt=""
              className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-player-artwork-layered"
              style={{ ...imageStyle, opacity: 1 - state.crossfadeProgress }}
            />
          ) : null}
          {crossfadeTransition.incoming.albumCover ? (
            <CrateImage
              src={crossfadeTransition.incoming.albumCover}
              alt=""
              className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-player-artwork-layered"
              style={{ ...imageStyle, opacity: state.crossfadeProgress }}
            />
          ) : null}
        </>
      ) : currentTrack.albumCover ? (
        <CrateImage
          src={currentTrack.albumCover}
          alt=""
          className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-player-artwork-layered"
          style={imageStyle}
        />
      ) : (
        <div className="absolute inset-0 rounded-xl bg-surface-quiet-subtle shadow-player-artwork" />
      )}
    </>
  );
}

function ExtendedPlayerVisualizerCanvas({
  refs,
  state,
}: Pick<ExtendedPlayerViewProps, "refs" | "state">) {
  const isVisualizerMode = state.vizCfg.surfaceMode === "visualizer";
  return (
    <div
      className={cn(
        "pointer-events-none absolute",
        state.showVizSettings ? "z-30" : "z-10",
        isVisualizerMode && state.canvasRect ? "" : "hidden",
      )}
      style={
        state.canvasRect
          ? {
              top: state.canvasRect.top,
              left: state.canvasRect.left,
              width: state.canvasRect.width,
              height: state.canvasRect.height,
            }
          : undefined
      }
    >
      <canvas
        ref={refs.canvasRef}
        className="h-full w-full"
        data-viz-reference-size={
          state.canvasRect ? String(state.canvasRect.referenceSize) : undefined
        }
        style={{ background: "transparent" }}
      />
    </div>
  );
}

function ExtendedPlayerArtwork({
  actions,
  refs,
  state,
}: Pick<ExtendedPlayerViewProps, "actions" | "refs" | "state">) {
  return (
    <>
      <ExtendedPlayerCover actions={actions} refs={refs} state={state} />
      <ExtendedPlayerVisualizerCanvas refs={refs} state={state} />
    </>
  );
}

function ExtendedPlayerTrackDetails({
  actions,
  state,
  artistAvatarUrl,
  sourceLabel,
  markArtistPhotoFailed,
}: Pick<
  ExtendedPlayerViewProps,
  | "actions"
  | "state"
  | "artistAvatarUrl"
  | "sourceLabel"
  | "markArtistPhotoFailed"
>) {
  return (
    <div className="relative z-20 mt-6 max-w-full px-8 text-center">
      <PlayerTrackIdentity
        currentTrack={state.currentTrack}
        crossfadeTransition={state.crossfadeTransition}
        crossfadeProgress={state.crossfadeProgress}
        sourceLabel={sourceLabel}
        artistAvatarUrl={artistAvatarUrl}
        onArtistAvatarError={markArtistPhotoFailed}
        onArtistClick={actions.goToArtist}
        artistClickable={state.artistClickable}
        titleClassName="text-xl leading-tight"
        albumClassName="text-sm"
      />
      {state.vizCfg.trackVizProfile.hasAnalysis &&
      state.vizCfg.trackVizProfile.summary ? (
        <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.22em] text-text-muted">
          {state.vizCfg.trackVizProfile.summary}
        </p>
      ) : null}
      <PlayerSeekBar
        className="mx-auto mt-5 w-full max-w-[420px]"
        currentTime={state.displayedTime}
        duration={state.displayedDuration}
        onSeek={actions.seek}
        disabled={state.jamQueueLocked}
        showTimes
        variant="glow"
      />
    </div>
  );
}

function ExtendedPlayerTabs({
  actions,
  state,
  t,
}: Pick<ExtendedPlayerViewProps, "actions" | "state" | "t">) {
  return (
    <div className="flex w-1/2 flex-col bg-surface-canvas">
      <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              actions.onTabChange(item.id);
            }}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              state.tab === item.id
                ? "bg-surface-control text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
        {state.tab === "queue" ? <QueueTab /> : null}
        {state.tab === "suggested" ? <SuggestedTab /> : null}
        {state.tab === "lyrics" ? (
          <LyricsTab useAlbumPalette={state.vizCfg.useAlbumPalette} />
        ) : null}
        {state.tab === "info" ? <InfoTab /> : null}
      </div>
    </div>
  );
}

export function ExtendedPlayerView({
  actions,
  refs,
  state,
  t,
  artistAvatarUrl,
  sourceLabel,
  markArtistPhotoFailed,
  open,
}: ExtendedPlayerViewProps) {
  return (
    <div
      className={cn(
        "z-app-extended-player fixed inset-0 flex bg-surface-canvas transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform",
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0",
      )}
    >
      <div
        ref={refs.panelRef}
        className="relative flex w-1/2 flex-col items-center justify-center overflow-hidden bg-surface-canvas"
      >
        <ExtendedPlayerHeader
          actions={actions}
          refs={refs}
          state={state}
          t={t}
        />
        <ExtendedPlayerArtwork actions={actions} refs={refs} state={state} />
        <ExtendedPlayerTrackDetails
          actions={actions}
          state={state}
          artistAvatarUrl={artistAvatarUrl}
          sourceLabel={sourceLabel}
          markArtistPhotoFailed={markArtistPhotoFailed}
        />
      </div>
      <ExtendedPlayerTabs actions={actions} state={state} t={t} />
    </div>
  );
}
