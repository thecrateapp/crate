import type { TFunction } from "i18next";
import { PlayerSeekBar } from "./PlayerSeekBar";
import { formatPlayerTime } from "./player-bar-utils";
export type PlayerSeekHover = { pct: number; time: string };
interface PlayerBarProgressProps {
  effectiveDisplayedDuration: number;
  effectiveDisplayedTime: number;
  jamQueueLocked: boolean;
  onSeek: (time: number) => void;
  onSeekHoverChange?: (value: PlayerSeekHover | null) => void;
  progressPct?: number;
  seekHover?: PlayerSeekHover | null;
  t?: TFunction;
}
/** Bar geometry: time and seek share one row; the native control owns draft, hover and keyboard. */
export function PlayerBarProgress({
  effectiveDisplayedDuration,
  effectiveDisplayedTime,
  jamQueueLocked,
  onSeek,
}: PlayerBarProgressProps) {
  return (
    <div
      data-slot="player-bar-progress"
      className="flex w-full items-center gap-2"
    >
      <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">
        {formatPlayerTime(effectiveDisplayedTime)}
      </span>
      <PlayerSeekBar
        className="min-w-0 flex-1"
        currentTime={effectiveDisplayedTime}
        duration={effectiveDisplayedDuration}
        onSeek={onSeek}
        disabled={jamQueueLocked}
        compact
        thin
        variant="glow"
      />
      <span className="w-9 shrink-0 font-mono text-xs tabular-nums text-text-muted">
        {formatPlayerTime(effectiveDisplayedDuration)}
      </span>
    </div>
  );
}
