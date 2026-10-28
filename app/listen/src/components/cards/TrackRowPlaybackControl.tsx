import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { useId, type MouseEvent, type ReactNode } from "react";
import { Play, Pause, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
export function TrackRowPlaybackProgressView({
  isPlaying,
  currentTime,
  duration,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const size = 38;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress =
    Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(1, currentTime / duration))
      : 0;

  return (
    <span
      className="group/track-progress track-row-playback-progress relative isolate flex size-full items-center justify-center overflow-visible rounded-full backdrop-blur-md"
      data-testid="track-row-playback-progress"
      aria-hidden="true"
    >
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-aura pointer-events-none absolute -inset-[13px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] opacity-[0.64] blur-[1px]",
          isPlaying && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-rim pointer-events-none absolute inset-[4px] z-10 rounded-full opacity-70",
          isPlaying && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "track-row-playback-core pointer-events-none absolute inset-[2px] z-20 rounded-full",
          isPlaying && "animate-crate-play-core-pulse",
        )}
      />
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-[1px] z-30 size-[calc(100%-2px)] -rotate-90 overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="track-row-playback-gradient-start" />
            <stop offset="48%" className="track-row-playback-gradient-mid" />
            <stop offset="100%" className="track-row-playback-gradient-end" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="track-row-playback-track"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          strokeWidth={stroke}
          className="track-row-playback-ring transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      {isPlaying ? (
        <Pause
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40"
          fill="currentColor"
        />
      ) : (
        <Play
          size={CRATE_ICON_SIZE.sm}
          className="track-row-playback-icon relative z-40 ml-0.5"
          fill="currentColor"
        />
      )}
    </span>
  );
}

export function TrackRowPlaybackControl({
  disabled,
  index,
  isActive,
  isPlaying,
  label,
  artwork,
  activeGlyph,
  onClick,
}: {
  disabled: boolean;
  index: number | string;
  isActive: boolean;
  isPlaying: boolean;
  label: string;
  artwork?: ReactNode;
  activeGlyph?: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = isActive && isPlaying ? Pause : Play;
  return (
    <TooltipHint content={label}>
      <button
        type="button"
        className={cn(
          "crate-track-leading shrink-0",
          isActive && "crate-track-leading-active",
          artwork != null && "crate-track-leading-artwork",
        )}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {artwork}
        {!isActive && artwork == null ? (
          <span aria-hidden="true" className="crate-track-index">
            {index}
          </span>
        ) : null}
        {!disabled ? (
          <span
            aria-hidden="true"
            className={cn(
              "crate-track-glyph",
              isActive && activeGlyph && "crate-track-glyph-progress",
            )}
          >
            {isActive && activeGlyph ? (
              activeGlyph
            ) : (
              <Icon
                size={artwork != null ? CRATE_ICON_SIZE.md : CRATE_ICON_SIZE.sm}
                fill="currentColor"
              />
            )}
          </span>
        ) : null}
      </button>
    </TooltipHint>
  );
}
