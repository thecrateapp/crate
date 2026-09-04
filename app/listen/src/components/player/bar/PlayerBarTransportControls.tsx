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
import { SpectrumPlayButton } from "@/components/player/SpectrumPlayButton";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";
import type { RepeatMode } from "@/contexts/player-types";

export type PlayerSeekHover = {
  pct: number;
  time: string;
};

type PlayerBarTransportControlsProps = {
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
    <div className="relative flex items-center justify-center gap-3 lg:gap-5">
      <button
        type="button"
        onClick={onToggleShuffle}
        disabled={jamQueueLocked}
        aria-label={
          shuffle ? t("player.disableShuffle") : t("player.enableShuffle")
        }
        className={`transition-colors disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
          shuffle
            ? "text-accent-action drop-shadow-accent-action"
            : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
        }`}
      >
        <Shuffle size={CRATE_ICON_SIZE.md} />
      </button>
      <button
        type="button"
        onClick={onPreviousTrack}
        disabled={jamQueueLocked}
        aria-label={t("player.previous")}
        className="text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:text-text-secondary"
      >
        <SkipBack size={CRATE_ICON_SIZE.lg} fill="currentColor" />
      </button>
      <PlayPauseControl
        t={t}
        effectiveIsPlaying={effectiveIsPlaying}
        effectiveIsBuffering={effectiveIsBuffering}
        onPlayPause={onPlayPause}
        disabled={jamTransportDisabled}
        size="sm"
      />
      <button
        type="button"
        onClick={onNextTrack}
        disabled={jamTransportDisabled}
        aria-label={t("player.next")}
        className="text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:text-text-secondary"
      >
        <SkipForward size={CRATE_ICON_SIZE.lg} fill="currentColor" />
      </button>
      <button
        type="button"
        onClick={onCycleRepeat}
        disabled={jamQueueLocked}
        aria-label={t("player.repeat", { mode: repeat })}
        className={`transition-colors disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 ${
          repeat !== "off"
            ? "text-accent-action drop-shadow-accent-action"
            : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
        }`}
      >
        {repeat === "one" ? (
          <Repeat1 size={CRATE_ICON_SIZE.md} />
        ) : (
          <Repeat size={CRATE_ICON_SIZE.md} />
        )}
      </button>
    </div>
  );
}

function DesktopTransportControls({
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
      <div className="relative w-full overflow-visible px-4 py-2">
        {showAnalyzer ? (
          <div className="player-analyzer-mask pointer-events-none absolute -inset-y-2 -inset-x-10 opacity-26">
            <WaveformCanvas
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

        <div className="relative mt-2 flex w-full items-center gap-2">
          <span className="w-9 text-right font-mono text-[10px] tabular-nums text-text-muted">
            {formatPlayerTime(effectiveDisplayedTime)}
          </span>
          <div
            className={`listen-player-progress group relative flex-1 py-2 ${
              jamQueueLocked
                ? "pointer-events-none grayscale opacity-40"
                : "cursor-pointer"
            }`}
            role="slider"
            tabIndex={jamQueueLocked ? -1 : 0}
            aria-label={actionProps.t("player.seek")}
            aria-disabled={jamQueueLocked}
            aria-valuemin={0}
            aria-valuemax={effectiveDisplayedDuration}
            aria-valuenow={effectiveDisplayedTime}
            aria-valuetext={formatPlayerTime(effectiveDisplayedTime)}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const pct = Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width),
              );
              onSeek(pct * effectiveDisplayedDuration);
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const pct = Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width),
              );
              onSeekHoverChange({
                pct,
                time: formatPlayerTime(pct * effectiveDisplayedDuration),
              });
            }}
            onPointerLeave={() => onSeekHoverChange(null)}
            onKeyDown={(event) => {
              if (jamQueueLocked) return;

              const step = 5;
              let nextTime: number;
              switch (event.key) {
                case "ArrowLeft":
                  nextTime = effectiveDisplayedTime - step;
                  break;
                case "ArrowRight":
                  nextTime = effectiveDisplayedTime + step;
                  break;
                case "Home":
                  nextTime = 0;
                  break;
                case "End":
                  nextTime = effectiveDisplayedDuration;
                  break;
                default:
                  return;
              }

              event.preventDefault();
              onSeek(
                Math.max(0, Math.min(effectiveDisplayedDuration, nextTime)),
              );
            }}
          >
            {seekHover && effectiveDisplayedDuration > 0 && (
              <div
                className="listen-player-progress-tooltip pointer-events-none absolute -top-6 -translate-x-1/2 rounded border px-1.5 py-0.5 text-[10px] tabular-nums"
                style={{ left: `${seekHover.pct * 100}%` }}
              >
                {seekHover.time}
              </div>
            )}
            <div className="listen-player-progress-track absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" />
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
              style={{ width: `${progressPct}%` }}
            >
              <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
              <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
            </div>
            <div
              className="listen-player-progress-fill absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-150"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="listen-player-progress-thumb pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-[left,opacity] duration-150"
              style={{
                left: `calc(${progressPct}% - 4px)`,
                opacity: progressPct > 0 ? 0.62 : 0,
              }}
            />
            <div
              className="listen-player-progress-thumb-active absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-[left,opacity] duration-150 group-hover:opacity-100"
              style={{ left: `calc(${progressPct}% - 5px)` }}
            />
          </div>
          <span className="w-9 font-mono text-[10px] tabular-nums text-text-muted">
            {formatPlayerTime(effectiveDisplayedDuration)}
          </span>
        </div>
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
    <div className="flex items-center gap-1 self-stretch md:hidden">
      <PlayPauseControl
        t={t}
        effectiveIsPlaying={effectiveIsPlaying}
        effectiveIsBuffering={effectiveIsBuffering}
        onPlayPause={onPlayPause}
        disabled={jamTransportDisabled}
        size="md"
      />
      <button
        type="button"
        onClick={onNextTrack}
        disabled={jamTransportDisabled}
        aria-label={t("player.next")}
        className="flex h-12 w-12 touch-manipulation items-center justify-center text-text-secondary transition-[color,filter,transform] hover:text-accent-action hover:drop-shadow-accent-action active:scale-[0.96] active:text-accent-action disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:text-text-secondary disabled:active:scale-100"
      >
        <SkipForward size={CRATE_ICON_SIZE.navMobile} fill="currentColor" />
      </button>
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
