import type { TFunction } from "i18next";
import type { TouchEventHandler } from "react";
import { cn } from "@crate/ui/lib/cn";
import { PlayerBarActionButtons } from "@/components/player/bar/PlayerBarActionButtons";
import { PlayerBarSurfaces } from "@/components/player/bar/PlayerBarSurfaces";
import { PlayerBarTrackInfo } from "@/components/player/bar/PlayerBarTrackInfo";
import {
  PlayerBarTransportControls,
  type PlayerSeekHover,
} from "@/components/player/bar/PlayerBarTransportControls";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import type { PlaybackTargetContext } from "@/lib/playback-targets";
import type { QualityBadge } from "@/components/player/bar/player-bar-utils";

type PlayerBarViewState = {
  isDesktop: boolean;
  liked: boolean;
  isShapedRadioTrack: boolean;
  effectiveIsPlaying: boolean;
  effectiveIsBuffering: boolean;
  isPlaying: boolean;
  shuffle: boolean;
  jamQueueLocked: boolean;
  jamTransportDisabled: boolean;
  showPlayerBarAnalyzer: boolean;
  isRemoteConnectActive: boolean;
  extendedOpen: boolean;
  allowEqualizer: boolean;
  showEqualizer: boolean;
  showQueue: boolean;
  showLyrics: boolean;
  hidePlayerBarForMobileFullscreen: boolean;
  hasFloatingOverlayOpen: boolean;
  fsOpen: boolean;
  shouldRenderQueuePanel: boolean;
  shouldRenderLyricsPanel: boolean;
  shouldRenderEqualizerPopover: boolean;
  shouldRenderExtendedPlayer: boolean;
  shouldRenderFullscreenPlayer: boolean;
};

type PlayerBarViewProps = {
  state: PlayerBarViewState;
  t: TFunction;
  displayTrack: Track;
  displayCrossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  displayPlaySource: PlaySource | null;
  sourceLabel: string | null;
  shapedRadioSessionId: string | null | undefined;
  effectiveDisplayedDuration: number;
  onNavigate: (path: string) => void;
  onPrepareFullscreen: () => void;
  onOpenFullscreen: () => void;
  onToggleLike: () => void;
  onNextTrack: () => void;
  onOverlayChange: (open: boolean) => void;
  handleTouchStart: TouchEventHandler<HTMLDivElement>;
  handleTouchEnd: TouchEventHandler<HTMLDivElement>;
  effectiveDisplayedTime: number;
  repeat: RepeatMode;
  frequenciesDb: number[];
  sampleRate: number;
  progressPct: number;
  seekHover: PlayerSeekHover | null;
  onSeekHoverChange: (value: PlayerSeekHover | null) => void;
  onToggleShuffle: () => void;
  onPreviousTrack: () => void;
  onPlayPause: () => void;
  onCycleRepeat: () => void;
  onSeek: (time: number) => void;
  qualityBadge: QualityBadge | null;
  showsDeliveryQuality: boolean;
  effectiveVolume: number;
  onVolumeChange: (volume: number) => void;
  playbackTargetContext: PlaybackTargetContext;
  displayQueue: Track[];
  displayCurrentIndex: number;
  onToggleEqualizer: () => void;
  onPrepareEqualizer: () => void;
  onToggleQueue: () => void;
  onPrepareQueue: () => void;
  onToggleLyrics: () => void;
  onPrepareLyrics: () => void;
  onToggleExtendedPlayer: () => void;
  onPrepareExtendedPlayer: () => void;
  onCloseQueue: () => void;
  onCloseLyrics: () => void;
  onCloseEqualizer: () => void;
  onCloseExtendedPlayer: () => void;
  onCloseFullscreenPlayer: () => void;
};

export function PlayerBarView({
  state,
  t,
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
  displayPlaySource,
  sourceLabel,
  shapedRadioSessionId,
  effectiveDisplayedDuration,
  onNavigate,
  onPrepareFullscreen,
  onOpenFullscreen,
  onToggleLike,
  onNextTrack,
  onOverlayChange,
  handleTouchStart,
  handleTouchEnd,
  effectiveDisplayedTime,
  repeat,
  frequenciesDb,
  sampleRate,
  progressPct,
  seekHover,
  onSeekHoverChange,
  onToggleShuffle,
  onPreviousTrack,
  onPlayPause,
  onCycleRepeat,
  onSeek,
  qualityBadge,
  showsDeliveryQuality,
  effectiveVolume,
  onVolumeChange,
  playbackTargetContext,
  displayQueue,
  displayCurrentIndex,
  onToggleEqualizer,
  onPrepareEqualizer,
  onToggleQueue,
  onPrepareQueue,
  onToggleLyrics,
  onPrepareLyrics,
  onToggleExtendedPlayer,
  onPrepareExtendedPlayer,
  onCloseQueue,
  onCloseLyrics,
  onCloseEqualizer,
  onCloseExtendedPlayer,
  onCloseFullscreenPlayer,
}: PlayerBarViewProps) {
  const {
    allowEqualizer,
    effectiveIsBuffering,
    effectiveIsPlaying,
    extendedOpen,
    fsOpen,
    hasFloatingOverlayOpen,
    hidePlayerBarForMobileFullscreen,
    isDesktop,
    isPlaying,
    isRemoteConnectActive,
    isShapedRadioTrack,
    jamQueueLocked,
    jamTransportDisabled,
    liked,
    showEqualizer,
    showLyrics,
    showPlayerBarAnalyzer,
    showQueue,
    shouldRenderEqualizerPopover,
    shouldRenderExtendedPlayer,
    shouldRenderFullscreenPlayer,
    shouldRenderLyricsPanel,
    shouldRenderQueuePanel,
    shuffle,
  } = state;
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {effectiveIsPlaying
          ? `Now playing ${displayTrack.title} by ${displayTrack.artist}`
          : `Paused: ${displayTrack.title} by ${displayTrack.artist}`}
      </div>

      {!hidePlayerBarForMobileFullscreen ? (
        <div
          className={cn(
            "fixed isolate h-[var(--listen-mobile-player-height)] overflow-visible transition-[bottom,left,right,height] duration-200 md:left-3 md:right-3 md:h-(--listen-desktop-player-height)",
            hasFloatingOverlayOpen ? "z-app-player-overlay" : "z-app-player",
          )}
          style={{
            bottom: isDesktop
              ? "var(--listen-desktop-player-bottom-offset)"
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
                ? "listen-player-shell md:rounded-panel md:backdrop-blur-xl"
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
              onNavigate={onNavigate}
              onPrepareFullscreen={onPrepareFullscreen}
              onOpenFullscreen={onOpenFullscreen}
              onToggleLike={onToggleLike}
              onNextTrack={onNextTrack}
              onOverlayChange={onOverlayChange}
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
              onSeekHoverChange={onSeekHoverChange}
              onToggleShuffle={onToggleShuffle}
              onPreviousTrack={onPreviousTrack}
              onPlayPause={onPlayPause}
              onNextTrack={onNextTrack}
              onCycleRepeat={onCycleRepeat}
              onSeek={onSeek}
            />

            <PlayerBarActionButtons
              t={t}
              qualityBadge={qualityBadge}
              showsDeliveryQuality={showsDeliveryQuality}
              effectiveVolume={effectiveVolume}
              onVolumeChange={onVolumeChange}
              onOverlayChange={onOverlayChange}
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
              onToggleEqualizer={onToggleEqualizer}
              onPrepareEqualizer={onPrepareEqualizer}
              onToggleQueue={onToggleQueue}
              onPrepareQueue={onPrepareQueue}
              onToggleLyrics={onToggleLyrics}
              onPrepareLyrics={onPrepareLyrics}
              onToggleExtendedPlayer={onToggleExtendedPlayer}
              onPrepareExtendedPlayer={onPrepareExtendedPlayer}
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
        onCloseQueue={onCloseQueue}
        onCloseLyrics={onCloseLyrics}
        onCloseEqualizer={onCloseEqualizer}
        onCloseExtendedPlayer={onCloseExtendedPlayer}
        onCloseFullscreenPlayer={onCloseFullscreenPlayer}
      />
    </>
  );
}
