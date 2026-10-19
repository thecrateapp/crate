import { useContext } from "react";
import { PlayerProgressContext } from "../../../contexts/player-progress-context";
import { PlayerBarProgress } from "./PlayerBarProgress";
import { PlayerSeekBar } from "./PlayerSeekBar";
/** Local clock lives here. Remote projection is supplied by the existing remote controller. */
export function PlayerProgressLeaf({
  remote,
  time,
  duration,
  onSeek,
  disabled,
  compact = false,
  className,
  showTimes = false,
  remaining = false,
}: {
  remote?: boolean;
  time?: number;
  duration?: number;
  onSeek: (value: number) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  showTimes?: boolean;
  remaining?: boolean;
}) {
  const progress = useContext(PlayerProgressContext) ?? {
    currentTime: 0,
    duration: 0,
  };
  if (compact)
    return (
      <PlayerBarProgress
        effectiveDisplayedTime={remote ? (time ?? 0) : progress.currentTime}
        effectiveDisplayedDuration={
          remote ? (duration ?? 0) : progress.duration
        }
        onSeek={onSeek}
        jamQueueLocked={!!disabled}
      />
    );
  return (
    <PlayerSeekBar
      remaining={remaining}
      currentTime={remote ? (time ?? 0) : progress.currentTime}
      duration={remote ? (duration ?? 0) : progress.duration}
      onSeek={onSeek}
      disabled={disabled}
      compact={compact}
      showTimes={showTimes}
      thin
      variant="glow"
      className={className}
    />
  );
}
