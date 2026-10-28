import { useSeekBarModel } from "./player-seek-bar-model";
import { DefaultSeekBar, GlowSeekBar } from "./PlayerSeekBarVariants";

interface PlayerSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  compact?: boolean;
  thin?: boolean;
  showTimes?: boolean;
  remaining?: boolean;
  className?: string;
  variant?: "default" | "glow";
  disabled?: boolean;
}

export function PlayerSeekBar({
  currentTime,
  duration,
  onSeek,
  compact = false,
  thin = false,
  showTimes = false,
  remaining = false,
  className = "",
  variant = "default",
  disabled = false,
}: PlayerSeekBarProps) {
  const model = useSeekBarModel(currentTime, duration, onSeek);

  return variant === "glow" ? (
    <GlowSeekBar
      remaining={remaining}
      compact={compact}
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    />
  ) : (
    <DefaultSeekBar
      remaining={remaining}
      className={className}
      compact={compact}
      thin={thin}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    />
  );
}
