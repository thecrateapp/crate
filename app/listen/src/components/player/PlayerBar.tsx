import { PlayerQualityContext } from "./player-quality-context";
import { PlayerProgressLeaf } from "./bar/PlayerProgressLeaf";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { PlayerBarView } from "@/components/player/bar/PlayerBarView";

import { usePlayerBarController } from "./usePlayerBarController";

export { PlayerSurfaceFallback } from "@/components/player/bar/PlayerSurfaceFallback";

export function PlayerBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const playerBar = usePlayerBarController();

  if (!playerBar.displayTrack) return null;

  return (
    <PlayerQualityContext
      value={{
        trackId: playerBar.displayTrack.id,
        badge: playerBar.qualityBadge,
        origin: playerBar.showsDeliveryQuality ? "stream" : "source",
        source: playerBar.sourceTrackQuality,
      }}
    >
      <PlayerBarView
        state={{
          isDesktop: playerBar.isDesktop,
          liked: playerBar.liked,
          isShapedRadioTrack: playerBar.isShapedRadioTrack,
          effectiveIsPlaying: playerBar.effectiveIsPlaying,
          effectiveIsBuffering: playerBar.effectiveIsBuffering,
          isPlaying: playerBar.isPlaying,
          shuffle: playerBar.shuffle,
          jamQueueLocked: playerBar.jamQueueLocked,
          jamTransportDisabled: playerBar.jamTransportDisabled,
          showPlayerBarAnalyzer: playerBar.showPlayerBarAnalyzer,
          isRemoteConnectActive: playerBar.isRemoteConnectActive,
          extendedOpen: playerBar.extendedOpen,
          allowEqualizer: playerBar.allowEqualizer,
          showEqualizer: playerBar.showEqualizer,
          showQueue: playerBar.showQueue,
          showLyrics: playerBar.showLyrics,
          hidePlayerBarForMobileFullscreen:
            playerBar.hidePlayerBarForMobileFullscreen,
          hasFloatingOverlayOpen: playerBar.hasFloatingOverlayOpen,
          fsOpen: playerBar.fsOpen,
          shouldRenderQueuePanel: playerBar.shouldRenderQueuePanel,
          shouldRenderLyricsPanel: playerBar.shouldRenderLyricsPanel,
          shouldRenderEqualizerPopover: playerBar.shouldRenderEqualizerPopover,
          shouldRenderExtendedPlayer: playerBar.shouldRenderExtendedPlayer,
          shouldRenderFullscreenPlayer: playerBar.shouldRenderFullscreenPlayer,
        }}
        progressSlot={
          <PlayerProgressLeaf
            remote={playerBar.isRemoteConnectActive}
            time={playerBar.effectiveDisplayedTime}
            duration={playerBar.effectiveDisplayedDuration}
            onSeek={playerBar.onSeek}
            disabled={playerBar.jamQueueLocked}
            compact
            showTimes
          />
        }
        readAudioFrame={playerBar.readAudioFrame}
        t={t}
        displayTrack={playerBar.displayTrack}
        displayCrossfadeTransition={playerBar.displayCrossfadeTransition}
        crossfadeProgress={playerBar.crossfadeProgress}
        displayPlaySource={playerBar.displayPlaySource}
        sourceLabel={playerBar.sourceLabel}
        shapedRadioSessionId={playerBar.shapedRadioSessionId}
        effectiveDisplayedDuration={playerBar.effectiveDisplayedDuration}
        onNavigate={navigate}
        onPrepareFullscreen={playerBar.onPrepareFullscreen}
        onOpenFullscreen={playerBar.onOpenFullscreen}
        onToggleLike={playerBar.onToggleLike}
        onNextTrack={playerBar.onNextTrack}
        onOverlayChange={playerBar.onOverlayChange}
        handleTouchStart={playerBar.handleTouchStart}
        handleTouchEnd={playerBar.handleTouchEnd}
        effectiveDisplayedTime={playerBar.effectiveDisplayedTime}
        repeat={playerBar.repeat}
        frequenciesDb={playerBar.frequenciesDb}
        sampleRate={playerBar.sampleRate}
        progressPct={playerBar.progressPct}
        seekHover={playerBar.seekHover}
        onSeekHoverChange={playerBar.onSeekHoverChange}
        onToggleShuffle={playerBar.onToggleShuffle}
        onPreviousTrack={playerBar.onPreviousTrack}
        onPlayPause={playerBar.onPlayPause}
        onCycleRepeat={playerBar.onCycleRepeat}
        onSeek={playerBar.onSeek}
        qualityBadge={playerBar.qualityBadge}
        showsDeliveryQuality={playerBar.showsDeliveryQuality}
        effectiveVolume={playerBar.effectiveVolume}
        onVolumeChange={playerBar.onVolumeChange}
        playbackTargetContext={playerBar.playbackTargetContext}
        displayQueue={playerBar.displayQueue}
        displayCurrentIndex={playerBar.displayCurrentIndex}
        onToggleEqualizer={playerBar.onToggleEqualizer}
        onPrepareEqualizer={playerBar.onPrepareEqualizer}
        onToggleQueue={playerBar.onToggleQueue}
        onPrepareQueue={playerBar.onPrepareQueue}
        onToggleLyrics={playerBar.onToggleLyrics}
        onPrepareLyrics={playerBar.onPrepareLyrics}
        onToggleExtendedPlayer={playerBar.onToggleExtendedPlayer}
        onPrepareExtendedPlayer={playerBar.onPrepareExtendedPlayer}
        onCloseQueue={playerBar.onCloseQueue}
        onCloseLyrics={playerBar.onCloseLyrics}
        onCloseEqualizer={playerBar.onCloseEqualizer}
        onCloseExtendedPlayer={playerBar.onCloseExtendedPlayer}
        onCloseFullscreenPlayer={playerBar.onCloseFullscreenPlayer}
      />
    </PlayerQualityContext>
  );
}
