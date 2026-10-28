import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  CRATE_ICON_SIZE,
  Shuffle,
  SkipBack,
  SkipForward,
} from "@crate/ui/icons";
import { SpectrumPlayButton } from "../SpectrumPlayButton";
import { PlayerBarProgress, type PlayerSeekHover } from "./PlayerBarProgress";
import { WaveformCanvas } from "./WaveformCanvas";
import type { RepeatMode } from "../../../contexts/player-types";

export type { PlayerSeekHover } from "./PlayerBarProgress";

type PlayerBarTransportControlsProps = {
  progressSlot?: ReactNode;
  readAudioFrame?: () => { frequenciesDb: number[]; sampleRate: number };
  t: TFunction;
  frequenciesDb: number[];
  sampleRate: number;
  showAnalyzer: boolean;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  jamQueueLocked: boolean;
  jamTransportDisabled: boolean;
  effectiveIsPlaying: boolean;
  effectiveIsBuffering: boolean;
  effectiveDisplayedTime: number;
  effectiveDisplayedDuration: number;
  progressPct: number;
  seekHover: PlayerSeekHover | null;
  onSeekHoverChange: (value: PlayerSeekHover | null) => void;
  onToggleShuffle: () => void;
  onPreviousTrack: () => void;
  onPlayPause: () => void;
  onNextTrack: () => void;
  onCycleRepeat: () => void;
  onSeek: (time: number) => void;
};

type TransportActionProps = Pick<
  PlayerBarTransportControlsProps,
  | "t"
  | "shuffle"
  | "repeat"
  | "jamQueueLocked"
  | "jamTransportDisabled"
  | "effectiveIsPlaying"
  | "effectiveIsBuffering"
  | "onToggleShuffle"
  | "onPreviousTrack"
  | "onPlayPause"
  | "onNextTrack"
  | "onCycleRepeat"
>;

function PlayPauseControl({
  t,
  effectiveIsPlaying,
  effectiveIsBuffering,
  onPlayPause,
  disabled,
  size,
}: Pick<
  TransportActionProps,
  "t" | "effectiveIsPlaying" | "effectiveIsBuffering" | "onPlayPause"
> & {
  disabled: boolean;
  size: "md" | "sm";
}) {
  const iconSize = size === "sm" ? CRATE_ICON_SIZE.md : CRATE_ICON_SIZE.lg;

  return (
    <SpectrumPlayButton
      onClick={onPlayPause}
      disabled={disabled}
      aria-label={effectiveIsPlaying ? t("player.pause") : t("player.play")}
      size={size}
      active={effectiveIsPlaying}
      className="touch-manipulation disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
    >
      {effectiveIsBuffering ? (
        <Loader2
          size={size === "sm" ? 17 : CRATE_ICON_SIZE.md}
          className="animate-spin text-text-primary"
        />
      ) : effectiveIsPlaying ? (
        <Pause size={iconSize} className="text-text-primary" />
      ) : (
        <Play
          size={iconSize}
          className="ml-0.5 text-text-primary"
          fill="currentColor"
        />
      )}
    </SpectrumPlayButton>
  );
}

function DesktopTransportActions({
  t,
  shuffle,
  repeat,
  jamQueueLocked,
  jamTransportDisabled,
  effectiveIsPlaying,
  effectiveIsBuffering,
  onToggleShuffle,
  onPreviousTrack,
  onPlayPause,
  onNextTrack,
  onCycleRepeat,
}: TransportActionProps) {
  return (
    <div
      data-slot="player-transport"
      className="relative flex items-center justify-center gap-0 lg:gap-1"
    >
      <ActionButton
        label={shuffle ? t("player.disableShuffle") : t("player.enableShuffle")}
        aria-pressed={shuffle}
        onClick={onToggleShuffle}
        disabled={jamQueueLocked}
      >
        <Shuffle size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
      <ActionButton
        label={t("player.previous")}
        onClick={onPreviousTrack}
        disabled={jamQueueLocked}
      >
        <SkipBack size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
      <div className="flex size-11 shrink-0 items-center justify-center">
        <PlayPauseControl
          t={t}
          effectiveIsPlaying={effectiveIsPlaying}
          effectiveIsBuffering={effectiveIsBuffering}
          onPlayPause={onPlayPause}
          disabled={jamTransportDisabled}
          size="sm"
        />
      </div>
      <ActionButton
        label={t("player.next")}
        onClick={onNextTrack}
        disabled={jamTransportDisabled}
      >
        <SkipForward size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
      <ActionButton
        label={t("player.repeat", { mode: repeat })}
        aria-pressed={repeat !== "off"}
        onClick={onCycleRepeat}
        disabled={jamQueueLocked}
      >
        {repeat === "one" ? (
          <Repeat1 size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Repeat size={CRATE_ICON_SIZE.lg} />
        )}
      </ActionButton>
    </div>
  );
}

function DesktopTransportControls({
  progressSlot,
  readAudioFrame,
  frequenciesDb,
  sampleRate,
  showAnalyzer,
  isPlaying,
  effectiveDisplayedTime,
  effectiveDisplayedDuration,
  progressPct,
  seekHover,
  jamQueueLocked,
  onSeekHoverChange,
  onSeek,
  ...actionProps
}: PlayerBarTransportControlsProps) {
  return (
    <div className="mx-auto hidden max-w-[640px] flex-1 md:flex md:items-center md:justify-center">
      <div className="relative w-full overflow-visible px-2 py-1">
        {showAnalyzer ? (
          <div className="player-analyzer-mask pointer-events-none absolute -inset-y-2 -inset-x-10 opacity-26">
            <WaveformCanvas
              readAudioFrame={readAudioFrame}
              frequenciesDb={frequenciesDb}
              sampleRate={sampleRate}
              isPlaying={isPlaying}
            />
          </div>
        ) : null}

        <DesktopTransportActions
          {...actionProps}
          jamQueueLocked={jamQueueLocked}
        />

        {progressSlot ?? (
          <PlayerBarProgress
            effectiveDisplayedDuration={effectiveDisplayedDuration}
            effectiveDisplayedTime={effectiveDisplayedTime}
            jamQueueLocked={jamQueueLocked}
            onSeek={onSeek}
            onSeekHoverChange={onSeekHoverChange}
            progressPct={progressPct}
            seekHover={seekHover}
            t={actionProps.t}
          />
        )}
      </div>
    </div>
  );
}

function MobileTransportControls({
  t,
  jamTransportDisabled,
  effectiveIsPlaying,
  effectiveIsBuffering,
  onPlayPause,
  onNextTrack,
}: Pick<
  PlayerBarTransportControlsProps,
  | "t"
  | "jamTransportDisabled"
  | "effectiveIsPlaying"
  | "effectiveIsBuffering"
  | "onPlayPause"
  | "onNextTrack"
>) {
  return (
    <div
      data-slot="mobile-transport"
      className="flex items-center gap-1 self-stretch md:hidden"
    >
      <PlayPauseControl
        t={t}
        effectiveIsPlaying={effectiveIsPlaying}
        effectiveIsBuffering={effectiveIsBuffering}
        onPlayPause={onPlayPause}
        disabled={jamTransportDisabled}
        size="md"
      />
      <ActionButton
        label={t("player.next")}
        onClick={onNextTrack}
        disabled={jamTransportDisabled}
      >
        <SkipForward size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
    </div>
  );
}

export function PlayerBarTransportControls(
  props: PlayerBarTransportControlsProps,
) {
  const {
    t,
    jamTransportDisabled,
    effectiveIsPlaying,
    effectiveIsBuffering,
    onPlayPause,
    onNextTrack,
  } = props;

  return (
    <>
      <DesktopTransportControls {...props} />
      <MobileTransportControls
        t={t}
        jamTransportDisabled={jamTransportDisabled}
        effectiveIsPlaying={effectiveIsPlaying}
        effectiveIsBuffering={effectiveIsBuffering}
        onPlayPause={onPlayPause}
        onNextTrack={onNextTrack}
      />
    </>
  );
}
