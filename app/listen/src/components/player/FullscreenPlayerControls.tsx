import type { TFunction } from "i18next";

import {
  Disc3,
  Loader2,
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
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import type {
  ViewActions,
  ViewPlayer,
  ViewState,
} from "@/components/player/fullscreen-player-view-types";
import { SpectrumPlayButton } from "@/components/player/SpectrumPlayButton";
import { triggerHaptic } from "@/lib/haptics";

interface FullscreenPlayerTransportControlsProps {
  actions: ViewActions;
  state: ViewState;
  t: TFunction;
}

function FullscreenPlayerTransportControls({
  state,
  actions,
  t,
}: FullscreenPlayerTransportControlsProps) {
  return (
    <div className="mx-auto mt-5 flex w-full max-w-[360px] items-center justify-center gap-3">
      <ActionButton
        aria-pressed={state.shuffle}
        onClick={actions.toggleShuffleWithFeedback}
        disabled={state.jamQueueLocked}
        label={
          state.shuffle ? t("player.disableShuffle") : t("player.enableShuffle")
        }
      >
        <Shuffle size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
      <ActionButton
        onClick={actions.goPrevWithFeedback}
        disabled={state.jamQueueLocked}
        label={t("player.previous")}
      >
        <SkipBack size={CRATE_ICON_SIZE.xl} fill="currentColor" />
      </ActionButton>
      <SpectrumPlayButton
        onClick={actions.togglePlaybackWithFeedback}
        disabled={state.jamTransportDisabled}
        aria-label={state.isPlaying ? t("player.pause") : t("player.play")}
        size="lg"
        active={state.isPlaying}
        className="touch-manipulation disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
      >
        {state.isBuffering ? (
          <Loader2
            size={CRATE_ICON_SIZE.xl}
            className="animate-spin text-accent-action"
          />
        ) : state.isPlaying ? (
          <Pause size={CRATE_ICON_SIZE.xl} className="text-text-primary" />
        ) : (
          <Play
            size={CRATE_ICON_SIZE.xl}
            className="ml-1 text-text-primary"
            fill="currentColor"
          />
        )}
      </SpectrumPlayButton>
      <ActionButton
        onClick={actions.goNextWithFeedback}
        disabled={state.jamTransportDisabled}
        label={t("player.next")}
      >
        <SkipForward size={CRATE_ICON_SIZE.xl} fill="currentColor" />
      </ActionButton>
      <ActionButton
        aria-pressed={state.repeat !== "off"}
        onClick={actions.cycleRepeatWithFeedback}
        disabled={state.jamQueueLocked}
        label={t("player.repeat", { mode: state.repeat })}
      >
        {state.repeat === "one" ? (
          <Repeat1 size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Repeat size={CRATE_ICON_SIZE.lg} />
        )}
      </ActionButton>
    </div>
  );
}

interface FullscreenPlayerUtilityControlsProps {
  actions: ViewActions;
  player: ViewPlayer;
  state: ViewState;
  t: TFunction;
}

function FullscreenPlayerUtilityControls({
  state,
  player,
  actions,
  t,
}: FullscreenPlayerUtilityControlsProps) {
  return (
    <div className="mx-auto mt-3 flex w-full max-w-[360px] items-center justify-center gap-2">
      <FollowHeartButton
        following={state.liked}
        label={t("actions.track.like")}
        labelActive={t("actions.track.unlike")}
        heartTestId="fullscreen-like-heart"
        particlesTestId="fullscreen-like-particles"
        iconSize={CRATE_ICON_SIZE.md}
        onClick={() => void actions.toggleLikeWithFeedback()}
        className="size-12 touch-manipulation rounded-full border border-border-subtle bg-surface-control active:bg-surface-control-hover"
      />
      {state.allowMobileEqualizer ? (
        <ActionButton
          ref={actions.equalizerButtonRef}
          onClick={() => {
            triggerHaptic("selection");
            actions.setShowEqualizer((value) => !value);
          }}
          label={t("player.equalizer")}
          aria-pressed={state.showEqualizer}
        >
          <SlidersHorizontal size={CRATE_ICON_SIZE.lg} />
        </ActionButton>
      ) : null}
      <ActionButton
        onClick={actions.toggleSurfaceModeWithFeedback}
        label={
          state.surfaceMode === "cd"
            ? t("player.surface.cover")
            : t("player.surface.cd")
        }
      >
        {state.surfaceMode === "cd" ? (
          <Square size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Disc3 size={CRATE_ICON_SIZE.lg} />
        )}
      </ActionButton>
      <PlayerTrackMenu
        currentTrack={player.currentTrack}
        className=" size-12 rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
      />
    </div>
  );
}

export function FullscreenPlayerControls({
  state,
  player,
  actions,
  t,
}: FullscreenPlayerUtilityControlsProps) {
  return (
    <>
      <FullscreenPlayerTransportControls
        state={state}
        actions={actions}
        t={t}
      />
      <FullscreenPlayerUtilityControls
        state={state}
        player={player}
        actions={actions}
        t={t}
      />
    </>
  );
}
